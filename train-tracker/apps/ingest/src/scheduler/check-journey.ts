// Features: one check of one journey, the scrape sources, RailRadar when the plan asks, the state the browser reads

import { windowHits } from '@train-tracker/core/accuracy/score';
import { estimate } from '@train-tracker/core/estimate';
import {
  afterFailure,
  afterSuccess,
  callVerdict,
  feedIsStalled,
  sourceUsable,
} from '@train-tracker/core/schedule/health';
import type { SourceHealth } from '@train-tracker/core/schedule/health';
import { normalizeEvents } from '@train-tracker/core/fusion/normalize';
import type { NormalizeContext } from '@train-tracker/core/fusion/normalize';
import { resolveEvents } from '@train-tracker/core/fusion/resolve';
import { hasLeftOrigin, nextCheck } from '@train-tracker/core/schedule/next-check';
import type { CheckReason } from '@train-tracker/core/schedule/next-check';
import { currentRunDate } from '@train-tracker/core/schedule/run-date';
import { parseRailRadarLive } from '@train-tracker/core/sources/railradar';
import { istDateOf, plusDays } from '@train-tracker/core/time';
import type {
  Estimate,
  IsoDate,
  IsoUtc,
  RawFetch,
  ResolvedEvent,
  SourceEvent,
  SourceId,
  TimetableStop,
} from '@train-tracker/core/types';
import { fetchRailRadarLive } from '../adapters/railradar.js';
import {
  journeyFor,
  journeyStatusOn,
  loggedWindowsFor,
  saveEstimate,
  saveWindowHits,
  sectionCapsFor,
  stationPointsFor,
  resolvedFor,
  saveResolvedEvents,
  saveSourceEvents,
  saveTrainState,
  sourceEventsFor,
  stateFor,
  timetableFor,
  topSpeedFor,
} from '../db/journey-data.js';
import { insertRawFetch, rawFetchRow, readsFor } from '../db/raw-fetches.js';
import { healthFor, saveHealth } from '../db/source-health.js';
import { log } from '../log.js';
import type { Config } from '../config.js';
import { askSources } from './check-sources.js';

const RAILRADAR: SourceId = 'railradar';
const YESTERDAY = -1;
const WRONG_RUN = 'wrong_run';

export type CheckInput = {
  trainNumber: string;
  config: Config;
  watchingSince: IsoUtc;
  dueAt: IsoUtc;
  now: IsoUtc;
};

export type CheckOutcome =
  | { kind: 'held'; readyAt: IsoUtc }
  | {
      kind: 'done';
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

/** Saves RailRadar's health after a call, and says whether the call failed */
async function saveCallHealth(
  input: CheckInput,
  health: SourceHealth,
  raw: RawFetch,
  parseErrors: number,
  unknownHalts: number,
): Promise<boolean> {
  // whether this call counts against the source, from callVerdict
  const verdict = callVerdict({
    status: raw.status,
    hasError: raw.error !== undefined,
    parseErrors,
    unknownHalts,
  });
  await saveHealth(
    RAILRADAR,
    verdict.failed ? afterFailure(health, input.now, verdict.isRateLimited) : afterSuccess(),
    input.now,
    input.config.db,
  );
  return verdict.failed;
}

/** Why this check is due */
function checkReason(
  hasState: boolean,
  confirmed: readonly ResolvedEvent[],
  stops: readonly TimetableStop[],
  where: Estimate,
): CheckReason {
  if (!hasState) {
    return 'catch_up';
  }
  if (!hasLeftOrigin(confirmed, stops)) {
    return 'departure';
  }
  return where.state === 'late' ? 'late' : 'window_open';
}

/** Asks RailRadar, storing its reply before anything can fail, and returns the events it gave */
async function askRailRadar(
  input: CheckInput,
  journeyId: string,
  context: NormalizeContext,
): Promise<SourceEvent[]> {
  const { trainNumber, config } = input;
  const health = await healthFor(RAILRADAR, config.db); // how RailRadar is behaving, from healthFor
  const usable = sourceUsable(health, input.now); // whether it may be called, from sourceUsable
  if (!usable.usable) {
    log('warn', usable.reason, { source: RAILRADAR, trainNumber, readyAt: usable.readyAt });
    return [];
  }

  const raw = await fetchRailRadarLive(trainNumber, config.railRadarApiKey); // the response, from fetchRailRadarLive
  const parsed = parseRailRadarLive(raw, ''); // the run and events it named, from parseRailRadarLive
  const isWrongRun = parsed.journeyDate !== null && parsed.journeyDate !== context.journeyDate;
  const stored = isWrongRun ? { ...raw, error: WRONG_RUN } : raw;
  const rawFetchId = await insertRawFetch(rawFetchRow(stored, journeyId), config.db); // the stored row, from insertRawFetch

  if (isWrongRun) {
    log('warn', 'check_wrong_run', { source: RAILRADAR, trainNumber, named: parsed.journeyDate });
    return [];
  }
  // events with the nonsense rules applied, from normalizeEvents
  const normalized = normalizeEvents(
    parsed.events.map((event) => ({ ...event, rawFetchId })),
    context,
  );
  const unknownHalts = normalized.filter((event) => event.rejected === 'unknown_halt').length;
  const failed = await saveCallHealth(input, health, raw, parsed.errors.length, unknownHalts); // whether the call failed, from saveCallHealth
  if (parsed.journeyDate === null) {
    log('warn', 'check_unreadable', {
      source: RAILRADAR,
      trainNumber,
      status: raw.status,
      error: raw.error,
      errors: parsed.errors.join(' | '),
      failed,
    });
    return [];
  }
  await saveSourceEvents(normalized, journeyId, config.db);
  return normalized;
}

/** Runs one check of one journey: the run first, then the scrape sources, RailRadar only if the plan says so */
export async function checkJourney(input: CheckInput): Promise<CheckOutcome> {
  const { trainNumber, config, now } = input;
  const [stops, topSpeedKmh, caps] = await Promise.all([
    timetableFor(trainNumber, config.db),
    topSpeedFor(trainNumber, config.db),
    sectionCapsFor(trainNumber, config.db),
  ]);
  const yesterday = await journeyStatusOn(
    trainNumber,
    plusDays(istDateOf(now), YESTERDAY),
    config.db,
  ); // how yesterday's run stands, from journeyStatusOn
  const journeyDate = currentRunDate({ stops, now, yesterday }); // the run to follow, from currentRunDate
  const journey = await journeyFor(trainNumber, journeyDate, config.db); // the journey, from journeyFor

  const [confirmedBefore, memory] = await Promise.all([
    resolvedFor(journey.id, config.db),
    stateFor(journey.id, config.db),
  ]);
  const learnedCaps = new Map(caps.map((cap) => [cap.fromSeq, cap.fastestPace]));
  // coordinates of our stops, from stationPointsFor
  const stations = await stationPointsFor(
    stops.map((stop) => stop.stationCode),
    config.db,
  );
  const context = {
    journeyDate,
    stops,
    topSpeedKmh,
    learnedCaps,
    confirmed: confirmedBefore,
    stations,
  };

  // where the train stood before this check, from estimate
  const before = estimate({
    journeyDate,
    stops,
    confirmed: confirmedBefore,
    topSpeedKmh,
    learnedCaps,
    now,
  });
  // the scrape sources' answer, from askSources
  const sources = await askSources({
    trainNumber,
    journey,
    config,
    now,
    dueAt: input.dueAt,
    context,
    check: checkReason(memory !== null, confirmedBefore, stops, before),
    windowStart: before.window?.windowStart ?? null,
  });
  const radarEvents =
    sources.status === 'done' && sources.railRadar?.ask === true
      ? await askRailRadar(input, journey.id, context)
      : [];

  if (sources.status === 'held' && sources.events.length === 0) {
    return { kind: 'held', readyAt: sources.readyAt ?? now };
  }

  const [events, reads] = await Promise.all([
    sourceEventsFor({ id: journey.id, trainNumber, journeyDate }, config.db), // every surviving event so far, from sourceEventsFor
    readsFor(journey.id, config.db), // every read so far, from readsFor
  ]);
  // one event per station and type, from resolveEvents
  const resolved = resolveEvents({ journeyId: journey.id, events, reads, resolvedAt: now });
  const graded = await gradeNewArrivals(journey.id, confirmedBefore, resolved, config.db); // arrivals graded, from gradeNewArrivals
  await saveResolvedEvents(resolved, config.db);

  // where the train is, from estimate
  const where = estimate({
    journeyDate,
    stops,
    confirmed: resolved,
    topSpeedKmh,
    learnedCaps,
    isFeedStalled: feedIsStalled(sources.updatedAts, now), // whether the pages are old, from feedIsStalled
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
  const nextCheckAt = sources.status === 'held' ? input.dueAt : due.at;

  await saveTrainState({ ...where, journeyId: journey.id, nextCheckAt, updatedAt: now }, config.db);
  await saveEstimate(journey.id, where, now, config.db);

  const normalized = [...sources.events, ...radarEvents];
  const rejected = normalized.filter((event) => event.rejected !== undefined).length;
  log('info', 'checked', {
    trainNumber,
    journeyDate,
    status: sources.status,
    state: where.state,
    km: Math.round(where.km),
    delayMin: where.delayMin,
    nextStation: where.nextStation,
    confirmed: resolved.length,
    graded,
    rejected,
    radar: sources.railRadar?.reason,
    reason: due.reason,
    nextCheckAt,
  });

  if (sources.status === 'held') {
    return { kind: 'held', readyAt: sources.readyAt ?? now };
  }
  return {
    kind: 'done',
    journeyId: journey.id,
    journeyDate,
    nextCheckAt: due.at,
    confirmed: resolved.length,
    rejected,
  };
}
