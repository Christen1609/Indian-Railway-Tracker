// Features: one check of one journey, from the fetch to the state the browser reads

import { windowHits } from '@train-tracker/core/accuracy/score';
import { estimate } from '@train-tracker/core/estimate';
import { afterFailure, afterSuccess, callVerdict } from '@train-tracker/core/schedule/health';
import type { SourceHealth } from '@train-tracker/core/schedule/health';
import { normalizeEvents } from '@train-tracker/core/fusion/normalize';
import { resolveEvents } from '@train-tracker/core/fusion/resolve';
import { nextCheck } from '@train-tracker/core/schedule/next-check';
import { parseRailRadarLive } from '@train-tracker/core/sources/railradar';
import type { IsoDate, IsoUtc, ResolvedEvent, SourceId } from '@train-tracker/core/types';
import { fetchRailRadarLive } from '../adapters/railradar.js';
import {
  journeyFor,
  loggedWindowsFor,
  saveEstimate,
  saveWindowHits,
  sectionCapsFor,
  resolvedFor,
  saveResolvedEvents,
  saveSourceEvents,
  saveTrainState,
  sourceEventsFor,
  timetableFor,
  topSpeedFor,
} from '../db/journey-data.js';
import { insertRawFetch, rawFetchRow, readsFor } from '../db/raw-fetches.js';
import { saveHealth } from '../db/source-health.js';
import { log } from '../log.js';
import type { Config } from '../config.js';

const RAILRADAR: SourceId = 'railradar';
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

/** Grades the windows we showed for any arrival this check was the first to confirm */
async function gradeNewArrivals(
  journeyId: string,
  before: readonly ResolvedEvent[],
  now: readonly ResolvedEvent[],
  db: Config['db'],
): Promise<number> {
  const known = new Set(
    before.filter((event) => event.type === 'ARR').map((event) => event.stationCode),
  );
  const fresh = now.filter((event) => event.type === 'ARR' && !known.has(event.stationCode));

  let graded = 0;
  for (const arrival of fresh) {
    const logged = await loggedWindowsFor(journeyId, arrival.stationCode, db); // windows we showed, from loggedWindowsFor
    const hits = windowHits(arrival.stationCode, arrival.at, logged); // one row per window, from windowHits
    await saveWindowHits(journeyId, hits, db);
    graded += hits.length;
  }
  return graded;
}

/** Runs one check of one journey, saving the raw response before anything can fail */
export async function checkJourney(input: CheckInput): Promise<CheckOutcome | null> {
  const { trainNumber, config, now } = input;
  const raw = await fetchRailRadarLive(trainNumber, config.railRadarApiKey); // the response, from fetchRailRadarLive
  const probe = parseRailRadarLive(raw, ''); // the run it named, from parseRailRadarLive
  const journeyDate = probe.journeyDate;

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

  if (journeyDate === null) {
    await insertRawFetch(rawFetchRow(raw, NO_JOURNEY), config.db);
    log('warn', 'check_unreadable', {
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

  const [stops, topSpeedKmh, caps, confirmedBefore] = await Promise.all([
    timetableFor(trainNumber, config.db),
    topSpeedFor(trainNumber, config.db),
    sectionCapsFor(trainNumber, config.db),
    resolvedFor(journey.id, config.db),
  ]);
  const learnedCaps = new Map(caps.map((cap) => [cap.fromSeq, cap.fastestPace]));

  // events with the nonsense rules applied, from normalizeEvents
  const normalized = normalizeEvents(parsed.events, {
    journeyDate,
    stops,
    topSpeedKmh,
    learnedCaps,
    confirmed: confirmedBefore,
  });
  await saveSourceEvents(normalized, journey.id, config.db);

  const [events, reads] = await Promise.all([
    sourceEventsFor({ id: journey.id, trainNumber, journeyDate }, config.db), // every surviving event so far, from sourceEventsFor
    readsFor(journey.id, config.db), // every read so far, from readsFor
  ]);
  // one event per station and type, from resolveEvents
  const resolved = resolveEvents({
    journeyId: journey.id,
    events,
    reads,
    resolvedAt: now,
  });
  await saveResolvedEvents(resolved, config.db);

  // where the train is, from estimate
  const where = estimate({
    journeyDate,
    stops,
    confirmed: resolved,
    topSpeedKmh,
    learnedCaps,
    now,
  });
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
  await saveEstimate(journey.id, where, now, config.db);

  const graded = await gradeNewArrivals(journey.id, confirmedBefore, resolved, config.db); // arrivals graded, from gradeNewArrivals

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
    graded,
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
