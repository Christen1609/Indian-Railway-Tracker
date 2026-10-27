// Features: grading an arrival against the windows we showed, the median width

import { minutesBetween } from '../time.js';
import type { IsoUtc } from '../types.js';

const NOTHING = 0;
const HALF = 2;

export type LoggedWindow = {
  at: IsoUtc;
  windowStart: IsoUtc;
  windowEnd: IsoUtc;
};

export type WindowHit = {
  stationCode: string;
  publishedAt: IsoUtc;
  arrivedAt: IsoUtc;
  windowStart: IsoUtc;
  windowEnd: IsoUtc;
  hit: boolean;
  widthMin: number;
  leadMin: number;
};

/** One row per window we showed for a stop, each graded against the arrival that followed */
export function windowHits(
  stationCode: string,
  arrivedAt: IsoUtc,
  logged: readonly LoggedWindow[],
): WindowHit[] {
  return logged
    .filter((window) => minutesBetween(window.at, arrivedAt) > NOTHING)
    .map((window) => ({
      stationCode,
      publishedAt: window.at,
      arrivedAt,
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
      hit:
        minutesBetween(window.windowStart, arrivedAt) >= NOTHING &&
        minutesBetween(arrivedAt, window.windowEnd) >= NOTHING,
      widthMin: minutesBetween(window.windowStart, window.windowEnd),
      leadMin: minutesBetween(window.at, arrivedAt),
    }));
}

/** The middle of a set of minute figures, zero when there are none */
export function medianMin(minutes: readonly number[]): number {
  if (minutes.length === NOTHING) {
    return NOTHING;
  }
  const sorted = [...minutes].sort((one, other) => one - other);
  const middle = Math.floor(sorted.length / HALF);
  const upper = sorted[middle] ?? NOTHING;
  return sorted.length % HALF === 1 ? upper : (upper + (sorted[middle - 1] ?? NOTHING)) / HALF;
}
