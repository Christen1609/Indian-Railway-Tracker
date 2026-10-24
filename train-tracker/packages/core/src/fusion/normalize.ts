// Features: canonical codes, the seven nonsense rules, the normalize pass

import { minutesBetween, timetableMinuteToUtc, toUtc } from '../time.js';
import type { IsoDate, RejectReason, ResolvedEvent, SourceEvent, TimetableStop } from '../types.js';

const CLOCK_DRIFT_MIN = 1;
const BEFORE_START_MIN = 30;
const MIN_PER_HOUR = 60;

export type NormalizeContext = {
  journeyDate: IsoDate;
  stops: readonly TimetableStop[];
  topSpeedKmh: number | null;
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

/** Why one event is nonsense, or null when it survives every rule */
function rejectionFor(
  event: SourceEvent,
  ctx: NormalizeContext,
  kmByStation: ReadonlyMap<string, number>,
  arrivalAt: ReadonlyMap<string, string>,
): RejectReason | null {
  if (!isUsableInstant(event.at) || !isUsableInstant(event.fetchedAt)) {
    return 'bad_format';
  }

  const km = kmByStation.get(event.stationCode);
  if (km === undefined) {
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
    const confirmedKm = kmByStation.get(confirmed.stationCode);
    if (confirmedKm === undefined) {
      continue;
    }
    if (confirmedKm > km && minutesBetween(confirmed.at, event.at) > 0) {
      return 'backwards';
    }
  }

  const latest = ctx.confirmed.reduce<ResolvedEvent | null>(
    (furthest, candidate) =>
      furthest === null || minutesBetween(furthest.at, candidate.at) > 0 ? candidate : furthest,
    null,
  );
  const latestKm = latest === null ? undefined : kmByStation.get(latest.stationCode);
  if (ctx.topSpeedKmh !== null && latest !== null && latestKm !== undefined) {
    const minutes = minutesBetween(latest.at, event.at);
    const distanceKm = Math.abs(km - latestKm);
    if (minutes > 0 && distanceKm / (minutes / MIN_PER_HOUR) > ctx.topSpeedKmh) {
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
  const kmByStation = new Map(ctx.stops.map((stop) => [stop.stationCode, stop.km]));
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
    const reason = rejectionFor(event, ctx, kmByStation, arrivalAt);
    return reason === null ? event : { ...event, rejected: reason };
  });
}
