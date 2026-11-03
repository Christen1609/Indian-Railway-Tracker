// Features: one check of one journey, from the run date to the state the browser reads, without RailRadar

import { windowHits } from '@train-tracker/core/accuracy/score';
import { estimate } from '@train-tracker/core/estimate';
import { feedIsStalled } from '@train-tracker/core/schedule/health';
import { resolveEvents } from '@train-tracker/core/fusion/resolve';
import { hasLeftOrigin, nextCheck } from '@train-tracker/core/schedule/next-check';
import type { CheckReason } from '@train-tracker/core/schedule/next-check';
import { currentRunDate } from '@train-tracker/core/schedule/run-date';
import { istDateOf, plusDays } from '@train-tracker/core/time';
import type {
  Estimate,
  IsoDate,
  IsoUtc,
  ResolvedEvent,
  TimetableStop,
} from '@train-tracker/core/types';
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
  saveTrainState,
  sourceEventsFor,
  stateFor,
  timetableFor,
  topSpeedFor,
} from '../db/journey-data.js';
import { readsFor } from '../db/raw-fetches.js';
import { log } from '../log.js';
import type { Config } from '../config.js';
import { askSources } from './check-sources.js';

const YESTERDAY = -1;

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

/** Why this check is due, as far as RailRadar cares: not an arrival until the train has left and a state exists */
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

/** Runs one check of one journey: the run first, then the scrape sources in order */
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

  const rejected = sources.events.filter((event) => event.rejected !== undefined).length;
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
