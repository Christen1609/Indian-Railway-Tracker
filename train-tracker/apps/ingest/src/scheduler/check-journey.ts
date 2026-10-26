// Features: one check of one journey, from the fetch to the state the browser reads

import { estimate } from '@train-tracker/core/estimate';
import { afterFailure, afterSuccess, callVerdict } from '@train-tracker/core/schedule/health';
import type { SourceHealth } from '@train-tracker/core/schedule/health';
import { normalizeEvents } from '@train-tracker/core/fusion/normalize';
import { resolveEvents } from '@train-tracker/core/fusion/resolve';
import { nextCheck } from '@train-tracker/core/schedule/next-check';
import { parseRailRadarLive } from '@train-tracker/core/sources/railradar';
import type { IsoDate, IsoUtc, SourceId } from '@train-tracker/core/types';
import { fetchRailRadarLive } from '../adapters/railradar.js';
import {
  journeyFor,
  resolvedFor,
  saveResolvedEvents,
  saveSourceEvents,
  saveTrainState,
  timetableFor,
  topSpeedFor,
} from '../db/journey-data.js';
import { insertRawFetch, rawFetchRow } from '../db/raw-fetches.js';
import { saveHealth } from '../db/source-health.js';
import { log } from '../log.js';
import type { Config } from '../config.js';

const RAILRADAR: SourceId = 'railradar';
const ASKED: SourceId[] = [RAILRADAR];
const NO_JOURNEY = null;

export type CheckInput = {
  trainNumber: string;
  config: Config;
  health: SourceHealth;
  watchingSince: IsoUtc;
  now: IsoUtc;
};

export type CheckOutcome = {
  journeyId: string;
  journeyDate: IsoDate;
  nextCheckAt: IsoUtc | null;
  confirmed: number;
  rejected: number;
};

/** Runs one check of one journey, saving the raw response before anything can fail */
export async function checkJourney(input: CheckInput): Promise<CheckOutcome | null> {
  const { trainNumber, config, now } = input;
  const raw = await fetchRailRadarLive(trainNumber, config.railRadarApiKey); // the response, from fetchRailRadarLive
  const probe = parseRailRadarLive(raw, ''); // events, from parseRailRadarLive
  const journeyDate = probe.events[0]?.journeyDate;

  // whether this call counts against the source, from callVerdict
  const verdict = callVerdict({
    status: raw.status,
    hasError: raw.error !== undefined,
    parseErrors: probe.errors.length,
  });
  await saveHealth(
    RAILRADAR,
    verdict.failed ? afterFailure(input.health, now, verdict.isRateLimited) : afterSuccess(),
    now,
    config.db,
  );

  if (journeyDate === undefined) {
    await insertRawFetch(rawFetchRow(raw, NO_JOURNEY), config.db);
    log('warn', 'check_gave_nothing', {
      source: RAILRADAR,
      trainNumber,
      status: raw.status,
      error: raw.error,
      errors: probe.errors.join(' | '),
    });
    return null;
  }

  const journey = await journeyFor(trainNumber, journeyDate, config.db); // the journey, from journeyFor
  const rawFetchId = await insertRawFetch(rawFetchRow(raw, journey.id), config.db); // the stored row, from insertRawFetch
  const parsed = parseRailRadarLive(raw, rawFetchId); // events, from parseRailRadarLive

  const [stops, topSpeedKmh, confirmedBefore] = await Promise.all([
    timetableFor(trainNumber, config.db),
    topSpeedFor(trainNumber, config.db),
    resolvedFor(journey.id, config.db),
  ]);

  // events with the nonsense rules applied, from normalizeEvents
  const normalized = normalizeEvents(parsed.events, {
    journeyDate,
    stops,
    topSpeedKmh,
    confirmed: confirmedBefore,
  });
  await saveSourceEvents(normalized, journey.id, config.db);

  // one event per station and type, from resolveEvents
  const resolved = resolveEvents({
    journeyId: journey.id,
    events: normalized,
    asked: ASKED,
    resolvedAt: now,
  });
  await saveResolvedEvents(resolved, config.db);

  // where the train is, from estimate
  const where = estimate({ journeyDate, stops, confirmed: resolved, topSpeedKmh, now });
  // when it is next due a check, from nextCheck
  const due = nextCheck({
    journeyDate,
    stops,
    confirmed: resolved,
    estimate: where,
    watchingSince: input.watchingSince,
    isScored: journey.isScored,
    lastCheckedAt: now,
    now,
    intervals: config.intervals,
  });

  await saveTrainState(
    { ...where, journeyId: journey.id, nextCheckAt: due.at, updatedAt: now },
    config.db,
  );

  const rejected = normalized.filter((event) => event.rejected !== undefined).length;
  log('info', 'checked', {
    source: RAILRADAR,
    failed: verdict.failed,
    trainNumber,
    journeyDate,
    status: raw.status,
    latencyMs: raw.latencyMs,
    state: where.state,
    km: Math.round(where.km),
    delayMin: where.delayMin,
    nextStation: where.nextStation,
    confirmed: resolved.length,
    rejected,
    reason: due.reason,
    nextCheckAt: due.at,
    parseErrors: parsed.errors.length,
  });

  return {
    journeyId: journey.id,
    journeyDate,
    nextCheckAt: due.at,
    confirmed: resolved.length,
    rejected,
  };
}
