// Features: sections from a timetable, section pace, recent pace, section caps

import { assert } from './types.js';
import type { TimetableStop } from './types.js';

const ETA_MIN_PER_100KM = 8;
const SPARE_BLOCK_KM = 100;
const LATEST_WEIGHT = 0.6;
const PREVIOUS_WEIGHT = 0.4;
const RECENT_SECTIONS = 2;
const TIMETABLE_PACE = 1;
const MIN_PER_HOUR = 60;

export type Section = {
  fromSeq: number;
  toSeq: number;
  distanceKm: number;
  timetabledMin: number;
};

/** The sections of a timetable, one between each pair of stops it can measure */
export function sections(stops: readonly TimetableStop[]): Section[] {
  const built: Section[] = [];
  for (let index = 0; index + 1 < stops.length; index += 1) {
    const from = stops[index];
    const to = stops[index + 1];
    if (from?.schedDepMin == null || to?.schedArrMin == null) {
      continue;
    }
    built.push({
      fromSeq: from.seq,
      toSeq: to.seq,
      distanceKm: to.km - from.km,
      timetabledMin: to.schedArrMin - from.schedDepMin,
    });
  }
  return built;
}

/** Pace of one finished section: below 1 ran fast, above 1 ran slow */
export function sectionPace(actualMin: number, timetabledMin: number): number {
  assert(timetabledMin > 0, `a timetabled run time above zero, got ${timetabledMin}`);
  assert(actualMin >= 0, `a run time of zero or more, got ${actualMin}`);
  return actualMin / timetabledMin;
}

/** Recent pace, leaning on the latest of the last two finished sections */
export function recentPace(finished: readonly number[]): number {
  const recent = finished.slice(-RECENT_SECTIONS);
  const latest = recent[recent.length - 1];
  const previous = recent.length < RECENT_SECTIONS ? undefined : recent[0];
  if (latest === undefined) {
    return TIMETABLE_PACE;
  }
  return previous === undefined ? latest : latest * LATEST_WEIGHT + previous * PREVIOUS_WEIGHT;
}

/** The fastest pace allowed on a section, with a learned cap taking over when it is faster */
export function sectionCap(
  section: Section,
  topSpeedKmh: number | null,
  learnedFastestPace?: number,
): number {
  const { distanceKm, timetabledMin } = section;
  assert(timetabledMin > 0, `a timetabled run time above zero, got ${timetabledMin}`);

  const spareMin = (ETA_MIN_PER_100KM * distanceKm) / SPARE_BLOCK_KM;
  const spareCap = (timetabledMin - spareMin) / timetabledMin;
  const speedCap =
    topSpeedKmh === null ? spareCap : ((distanceKm / topSpeedKmh) * MIN_PER_HOUR) / timetabledMin;
  const cap = Math.max(spareCap, speedCap);

  return learnedFastestPace !== undefined && learnedFastestPace < cap ? learnedFastestPace : cap;
}

/** A pace held back to its section cap, since nothing may run faster than the cap allows */
export function capPace(pace: number, cap: number): number {
  const capped = Math.max(pace, cap);
  assert(capped >= cap, `a pace at or above the section cap ${cap}, got ${pace}`);
  return capped;
}
