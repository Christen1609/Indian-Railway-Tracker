// Features: source timestamps to UTC, IST dates, timetable minutes, day offset, IST clock

import { assert } from './types.js';
import type { IsoDate, IsoUtc } from './types.js';

const IST_OFFSET_MIN = 330;
const MINUTES_PER_DAY = 1440;
const MS_PER_MINUTE = 60_000;
const OFFSET_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Whether a date string names a day that exists, since Date.parse rolls 30 Feb into March */
function isRealDate(date: string): boolean {
  if (!CALENDAR_DATE.test(date)) {
    return false;
  }
  const ms = Date.parse(`${date}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().startsWith(date);
}

/** Milliseconds at midnight IST on a journey date */
function midnightIstMs(journeyDate: IsoDate): number {
  // whether the day exists, from isRealDate
  assert(isRealDate(journeyDate), `a real journey date as YYYY-MM-DD, got ${journeyDate}`);
  return Date.parse(`${journeyDate}T00:00:00+05:30`);
}

/** Converts a source timestamp that carries its own offset to UTC, or null if it does not */
export function toUtc(timestamp: string): IsoUtc | null {
  if (!OFFSET_TIMESTAMP.test(timestamp) || !isRealDate(timestamp.slice(0, 10))) {
    return null;
  }
  const ms = Date.parse(timestamp);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** IST calendar date of a UTC instant, for the journey date of an origin departure */
export function istDateOf(at: IsoUtc): IsoDate {
  const ms = Date.parse(at);
  assert(!Number.isNaN(ms), `a UTC timestamp, got ${at}`);
  return new Date(ms + IST_OFFSET_MIN * MS_PER_MINUTE).toISOString().slice(0, 10);
}

/** Timetable minute to the UTC instant it falls on */
export function timetableMinuteToUtc(journeyDate: IsoDate, minute: number): IsoUtc {
  const midnight = midnightIstMs(journeyDate); // midnight IST in ms, from midnightIstMs
  return new Date(midnight + minute * MS_PER_MINUTE).toISOString();
}

/** UTC instant to minutes from midnight IST on day 1, rounded to the minute */
export function utcToTimetableMinute(journeyDate: IsoDate, at: IsoUtc): number {
  const midnight = midnightIstMs(journeyDate); // midnight IST in ms, from midnightIstMs
  const ms = Date.parse(at);
  assert(!Number.isNaN(ms), `a UTC timestamp, got ${at}`);
  return Math.round((ms - midnight) / MS_PER_MINUTE);
}

/** Which journey day a timetable minute falls on, origin being day 1 */
export function dayOffset(minute: number): number {
  return Math.floor(minute / MINUTES_PER_DAY) + 1;
}

/** Timetable minute as an IST wall clock, without its day */
export function formatIstClock(minute: number): string {
  const inDay = ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(inDay / 60);
  return `${String(hours).padStart(2, '0')}:${String(inDay % 60).padStart(2, '0')}`;
}
