// Features: source timestamps to UTC, IST dates, month progress, timetable minutes, elapsed minutes, day offset, IST clock

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

/** How far through its month an IST date is: the day it falls on, and the days that month has */
export function istMonthProgress(at: IsoUtc): { day: number; days: number } {
  const date = istDateOf(at); // the IST calendar date, from istDateOf
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return { day: Number(date.slice(8, 10)), days: new Date(Date.UTC(year, month, 0)).getUTCDate() };
}

/** The UTC instant the IST month of a date began */
export function istMonthStart(at: IsoUtc): IsoUtc {
  const date = istDateOf(at); // the IST calendar date, from istDateOf
  const ms = Date.parse(`${date.slice(0, 7)}-01T00:00:00+05:30`);
  assert(!Number.isNaN(ms), `a UTC timestamp, got ${at}`);
  return new Date(ms).toISOString();
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

/** Whole minutes from one UTC instant to another, negative when it runs backwards */
export function minutesBetween(from: IsoUtc, to: IsoUtc): number {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  assert(!Number.isNaN(fromMs), `a UTC timestamp, got ${from}`);
  assert(!Number.isNaN(toMs), `a UTC timestamp, got ${to}`);
  return Math.round((toMs - fromMs) / MS_PER_MINUTE);
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
