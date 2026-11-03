// Features: the retention sweep

import { issueFor } from '@train-tracker/core/schedule/issue';
import { arrivalsConfirmed, isThinTrip } from '@train-tracker/core/schedule/thin-trip';
import { openIssue } from '../adapters/issues.js';
import { learnCaps, observedPaces } from '@train-tracker/core/estimate';
import { retentionCheck } from '@train-tracker/core/schedule/retention';
import type { IsoUtc } from '@train-tracker/core/types';
import type { Config } from '../config.js';
import {
  clearBodiesFor,
  deleteDerivedFor,
  markCleaned,
  resolvedFor,
  saveSectionCaps,
  sectionCapsFor,
  timetableFor,
  uncleanedJourneys,
} from '../db/journey-data.js';
import { log } from '../log.js';

/** Clears what each unswept journey no longer needs to keep, and marks it cleaned */
export async function sweepJourneys(config: Config, now: IsoUtc): Promise<void> {
  const journeys = await uncleanedJourneys(config.db); // the journeys left to sweep, from uncleanedJourneys

  log('info', 'retention_started', {
    journeys: journeys.length,
    retentionHours: config.retentionHours,
  });

  for (const journey of journeys) {
    const [stops, confirmed] = await Promise.all([
      timetableFor(journey.trainNumber, config.db),
      resolvedFor(journey.id, config.db),
    ]);

    // what may go, from retentionCheck
    const verdict = retentionCheck({
      journeyDate: journey.journeyDate,
      stops,
      confirmed,
      retentionHours: config.retentionHours,
      now,
    });

    const fields = {
      trainNumber: journey.trainNumber,
      journeyDate: journey.journeyDate,
      reason: verdict.reason,
      endedAt: verdict.endedAt,
    };

    if (!verdict.clearRaw) {
      log('debug', 'retention_held', fields);
      continue;
    }

    await clearBodiesFor(journey.id, config.db);
    if (verdict.deleteDerived) {
      if (isThinTrip(stops, confirmed)) {
        const counts = arrivalsConfirmed(stops, confirmed); // the arrivals confirmed, from arrivalsConfirmed
        const draft = issueFor({
          outcome: 'thin_trip',
          trainNumber: journey.trainNumber,
          journeyDate: journey.journeyDate,
          ...counts,
        });
        if (draft !== null) {
          await openIssue(draft, config.issues, now);
        }
      }
      // what this run managed on each section, from observedPaces
      const ran = observedPaces(stops, confirmed, journey.journeyDate);
      const known = await sectionCapsFor(journey.trainNumber, config.db); // the record so far, from sectionCapsFor
      await saveSectionCaps(journey.trainNumber, learnCaps(known, ran), now, config.db);
      await deleteDerivedFor(journey.id, config.db);
      await markCleaned(journey.id, now, config.db);
    }
    log('info', 'retention_swept', fields);
  }
}
