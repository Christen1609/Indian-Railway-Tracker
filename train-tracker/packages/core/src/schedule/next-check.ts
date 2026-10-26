// Features: check ladders, catch-up freshness, the next check due for a journey

import { minutesBetween, timetableMinuteToUtc, utcToTimetableMinute } from '../time.js';
import { assert } from '../types.js';
import type { Estimate, IsoDate, IsoUtc, ResolvedEvent, TimetableStop } from '../types.js';

const WINDOW_CHECK_INTERVAL_MIN = 5;
const LATE_CHECK_INTERVALS_MIN = [5, 5, 10, 10, 15];
const DEPARTURE_CHECK_DELAY_MIN = 2;

export type CheckReason = 'catch_up' | 'departure' | 'window_open' | 'late';

export type SkipReason = 'not_watched' | 'arrived';

export type NextCheck = { at: IsoUtc; reason: CheckReason } | { at: null; reason: SkipReason };

export type CheckIntervals = {
  windowMin: number;
  lateMin: readonly number[];
  departureDelayMin: number;
};

export const DEFAULT_CHECK_INTERVALS: CheckIntervals = {
  windowMin: WINDOW_CHECK_INTERVAL_MIN,
  lateMin: LATE_CHECK_INTERVALS_MIN,
  departureDelayMin: DEPARTURE_CHECK_DELAY_MIN,
};

export type NextCheckInput = {
  journeyDate: IsoDate;
  stops: readonly TimetableStop[];
  confirmed: readonly ResolvedEvent[];
  estimate: Estimate;
  watchingSince: IsoUtc | null;
  isScored: boolean;
  lastCheckedAt: IsoUtc | null;
  now: IsoUtc;
  intervals?: CheckIntervals;
};

/** The first rung of a ladder after the last check: the anchor, each gap in turn, then the last gap for ever */
function nextRung(anchorMin: number, gaps: readonly number[], lastMin: number | null): number {
  if (lastMin === null || lastMin < anchorMin) {
    return anchorMin;
  }
  let rung = anchorMin;
  for (const gap of gaps) {
    rung += gap;
    if (rung > lastMin) {
      return rung;
    }
  }
  const repeat = gaps[gaps.length - 1];
  assert(repeat !== undefined && repeat > 0, `a ladder with a gap to repeat, got [${gaps.join()}]`);
  return rung + (Math.floor((lastMin - rung) / repeat) + 1) * repeat;
}

/** Whether the train has been confirmed to have left its origin */
function hasLeftOrigin(
  confirmed: readonly ResolvedEvent[],
  stops: readonly TimetableStop[],
): boolean {
  const origin = stops[0];
  if (origin === undefined) {
    return false;
  }
  return confirmed.some(
    (event) => event.stationCode !== origin.stationCode || event.type === 'DEP',
  );
}

/** Whether the state is new enough that an arriving watcher needs no catch-up check */
function isFresh(lastCheckedAt: IsoUtc | null, now: IsoUtc, windowMin: number): boolean {
  return lastCheckedAt !== null && minutesBetween(lastCheckedAt, now) < windowMin;
}

/** Whether this watching session has had a check of its own yet */
function needsCatchUp(input: NextCheckInput, windowMin: number): boolean {
  const { watchingSince, lastCheckedAt, now } = input;
  if (watchingSince === null) {
    return false;
  }
  const checkedThisSession =
    lastCheckedAt !== null && minutesBetween(watchingSince, lastCheckedAt) >= 0;
  // whether the state is new enough to skip the check, from isFresh
  return !checkedThisSession && !isFresh(lastCheckedAt, now, windowMin);
}

/** When this journey is next due a check, and why, or null when nothing is due */
export function nextCheck(input: NextCheckInput): NextCheck {
  const { journeyDate, stops, confirmed, estimate, lastCheckedAt, now } = input;
  const intervals = input.intervals ?? DEFAULT_CHECK_INTERVALS;

  if (estimate.state === 'arrived' || estimate.window === null) {
    return { at: null, reason: 'arrived' };
  }
  if (input.watchingSince === null && !input.isScored) {
    return { at: null, reason: 'not_watched' };
  }
  // whether this watching session still needs its own check, from needsCatchUp
  if (needsCatchUp(input, intervals.windowMin)) {
    return { at: now, reason: 'catch_up' };
  }

  const lastMin = lastCheckedAt === null ? null : utcToTimetableMinute(journeyDate, lastCheckedAt);
  const origin = stops[0];

  // whether the origin departure is still unconfirmed, from hasLeftOrigin
  if (!hasLeftOrigin(confirmed, stops) && origin?.schedDepMin != null) {
    const anchorMin = origin.schedDepMin + intervals.departureDelayMin;
    const dueMin = nextRung(anchorMin, [intervals.windowMin], lastMin); // the due minute, from nextRung
    return { at: timetableMinuteToUtc(journeyDate, dueMin), reason: 'departure' };
  }

  const startMin = utcToTimetableMinute(journeyDate, estimate.window.windowStart);
  const endMin = utcToTimetableMinute(journeyDate, estimate.window.windowEnd);
  const openMin = nextRung(startMin, [intervals.windowMin], lastMin); // the due minute, from nextRung
  if (openMin <= endMin) {
    return { at: timetableMinuteToUtc(journeyDate, openMin), reason: 'window_open' };
  }

  const [firstLate, ...laterGaps] = intervals.lateMin;
  assert(firstLate !== undefined, 'at least one late check interval');
  const lateMin = nextRung(endMin + firstLate, laterGaps, lastMin); // the due minute, from nextRung
  return { at: timetableMinuteToUtc(journeyDate, lateMin), reason: 'late' };
}
