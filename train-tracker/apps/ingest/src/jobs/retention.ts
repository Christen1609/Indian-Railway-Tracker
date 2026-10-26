// Features: the retention sweep

import { retentionCheck } from '@train-tracker/core/schedule/retention';
import { readConfig } from '../config.js';
import {
  deleteDerivedFor,
  deleteRawFor,
  hasScores,
  markCleaned,
  resolvedFor,
  timetableFor,
  uncleanedJourneys,
} from '../db/journey-data.js';
import { log } from '../log.js';

/** Deletes what each unswept journey no longer needs to keep */
async function main(): Promise<void> {
  const config = readConfig(process.env); // the validated config, from readConfig
  const now = new Date().toISOString();
  const journeys = await uncleanedJourneys(config.db); // the journeys left to sweep, from uncleanedJourneys

  log('info', 'retention_started', {
    journeys: journeys.length,
    retentionHours: config.retentionHours,
  });

  for (const journey of journeys) {
    const [stops, confirmed, scored] = await Promise.all([
      timetableFor(journey.trainNumber, config.db),
      resolvedFor(journey.id, config.db),
      hasScores(journey.id, config.db),
    ]);

    // what may go, from retentionCheck
    const verdict = retentionCheck({
      journeyDate: journey.journeyDate,
      stops,
      confirmed,
      hasScores: scored,
      retentionHours: config.retentionHours,
      now,
    });

    const fields = {
      trainNumber: journey.trainNumber,
      journeyDate: journey.journeyDate,
      reason: verdict.reason,
      endedAt: verdict.endedAt,
    };

    if (!verdict.deleteRaw) {
      log('debug', 'retention_held', fields);
      continue;
    }

    await deleteRawFor(journey.id, config.db);
    if (verdict.deleteDerived) {
      await deleteDerivedFor(journey.id, config.db);
      await markCleaned(journey.id, now, config.db);
    }
    log('info', 'retention_swept', fields);
  }
}

await main();
