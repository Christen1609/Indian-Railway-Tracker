// Features: canonical codes, the seven nonsense rules, the normalize pass

import { sectionCap, sections } from '../estimate.js';
import { minutesBetween, timetableMinuteToUtc, toUtc } from '../time.js';
import type { IsoDate, RejectReason, ResolvedEvent, SourceEvent, TimetableStop } from '../types.js';

const CLOCK_DRIFT_MIN = 1;
const BEFORE_START_MIN = 30;
const MIN_PER_HOUR = 60;
const PACE_TOLERANCE_MIN = 1;

export type NormalizeContext = {
  journeyDate: IsoDate;
  stops: readonly TimetableStop[];
  topSpeedKmh: number | null;
  learnedCaps?: ReadonlyMap<number, number>;
  confirmed: readonly ResolvedEvent[];
};

/** Canonical station code: trimmed and uppercase */
export function canonicalCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Whether a timestamp is a UTC instant we can do arithmetic on */
function isUsableInstant(timestamp: string): boolean {
  return toUtc(timestamp) !== null;
}

/** The UTC instant the train was timetabled to leave origin, or null without a timetable */
function originDeparture(ctx: NormalizeContext): string | null {
  const origin = ctx.stops.find((stop) => stop.schedDepMin !== null);
  return origin?.schedDepMin === undefined || origin.schedDepMin === null
    ? null
    : timetableMinuteToUtc(ctx.journeyDate, origin.schedDepMin);
}

/**
 * The fewest minutes the stretch between two stops may be run in, by this train's own
 * section caps, or null when the timetable cannot chain the two together.
 */
function fastestStretchMin(ctx: NormalizeContext, fromSeq: number, toSeq: number): number | null {
  const low = Math.min(fromSeq, toSeq);
  const high = Math.max(fromSeq, toSeq);
  const bySeq = new Map(sections(ctx.stops).map((section) => [section.fromSeq, section])); // sections, from sections

  let fastest = 0;
  let seq = low;
  while (seq < high) {
    const section = bySeq.get(seq);
    if (section === undefined) {
      return null;
    }
    // fastest pace allowed here, learned where we have seen the section run, from sectionCap
    const cap = sectionCap(section, ctx.topSpeedKmh, ctx.learnedCaps?.get(seq));
    fastest += section.timetabledMin * cap;
    seq = section.toSeq;
  }
  return seq === high ? fastest : null;
}

/** Why one event is nonsense, or null when it survives every rule */
function rejectionFor(
  event: SourceEvent,
  ctx: NormalizeContext,
  stopByCode: ReadonlyMap<string, TimetableStop>,
  arrivalAt: ReadonlyMap<string, string>,
): RejectReason | null {
  if (!isUsableInstant(event.at) || !isUsableInstant(event.fetchedAt)) {
    return 'bad_format';
  }

  const stop = stopByCode.get(event.stationCode);
  if (stop === undefined) {
    return 'off_route';
  }

  if (minutesBetween(event.fetchedAt, event.at) > CLOCK_DRIFT_MIN) {
    return 'future_time';
  }

  const departure = originDeparture(ctx); // timetabled origin departure, from originDeparture
  if (departure !== null && minutesBetween(event.at, departure) > BEFORE_START_MIN) {
    return 'before_start';
  }

  const arrival = arrivalAt.get(event.stationCode);
  if (event.type === 'DEP' && arrival !== undefined && minutesBetween(arrival, event.at) < 0) {
    return 'dep_before_arr';
  }

  for (const confirmed of ctx.confirmed) {
    if (confirmed.confidence !== 'high') {
      continue;
    }
    const confirmedStop = stopByCode.get(confirmed.stationCode);
    if (confirmedStop === undefined) {
      continue;
    }
    if (confirmedStop.km > stop.km && minutesBetween(confirmed.at, event.at) > 0) {
      return 'backwards';
    }
  }

  const latest = ctx.confirmed.reduce<ResolvedEvent | null>(
    (furthest, candidate) =>
      furthest === null || minutesBetween(furthest.at, candidate.at) > 0 ? candidate : furthest,
    null,
  );
  const latestStop = latest === null ? undefined : stopByCode.get(latest.stationCode);
  if (latest !== null && latestStop !== undefined) {
    const minutes = minutesBetween(latest.at, event.at);
    // the fewest minutes this stretch allows, from fastestStretchMin
    const fastest = fastestStretchMin(ctx, latestStop.seq, stop.seq);
    const distanceKm = Math.abs(stop.km - latestStop.km);
    if (minutes <= 0) {
      return null;
    }
    if (fastest !== null) {
      return minutes + PACE_TOLERANCE_MIN < fastest ? 'too_fast' : null;
    }
    if (ctx.topSpeedKmh !== null && distanceKm / (minutes / MIN_PER_HOUR) > ctx.topSpeedKmh) {
      return 'too_fast';
    }
  }

  return null;
}

/** Canonical events with every nonsense rule applied, rejections kept and labelled */
export function normalizeEvents(
  events: readonly SourceEvent[],
  ctx: NormalizeContext,
): SourceEvent[] {
  const stopByCode = new Map(ctx.stops.map((stop) => [stop.stationCode, stop]));
  const named = events.map((event) => ({
    ...event,
    stationCode: canonicalCode(event.stationCode), // canonical code, from canonicalCode
  }));

  const arrivalAt = new Map<string, string>();
  for (const event of named) {
    if (event.type === 'ARR') {
      arrivalAt.set(event.stationCode, event.at);
    }
  }
  for (const event of ctx.confirmed) {
    if (event.type === 'ARR' && !arrivalAt.has(event.stationCode)) {
      arrivalAt.set(canonicalCode(event.stationCode), event.at);
    }
  }

  return named.map((event) => {
    // the rule it broke, from rejectionFor
    const reason = rejectionFor(event, ctx, stopByCode, arrivalAt);
    return reason === null ? event : { ...event, rejected: reason };
  });
}
