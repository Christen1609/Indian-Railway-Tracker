// Features: IST clocks and dates, relative time, delay, pace, distance

import {
  dayOffset,
  formatIstClock,
  istDateOf,
  minutesBetween,
  timetableMinuteToUtc,
  utcToTimetableMinute,
} from '@train-tracker/core/time';
import type { ArrivalWindow, IsoDate, IsoUtc } from '@train-tracker/core/types';

const IST_ZONE = 'Asia/Kolkata';
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1440;
const MINOR_DELAY_MIN = 15;
const JOURNEY_DATE_PARTS: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
};

/** IST date words for an instant, such as "Tue 27 Oct 2026" */
function formatIstDate(at: IsoUtc, parts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-GB', { ...parts, timeZone: IST_ZONE })
    .formatToParts(new Date(at))
    .filter((part) => part.type !== 'literal')
    .map((part) => part.value)
    .join(' ');
}

/** Journey day after day 1, as a suffix */
function daySuffix(minute: number): string {
  const day = dayOffset(minute); // journey day, from dayOffset
  return day > 1 ? ` · day ${day}` : '';
}

/** Timetable minute as an IST clock, with its day after day 1 */
export function formatTimetableMinute(minute: number): string {
  return `${formatIstClock(minute)}${daySuffix(minute)}`; // IST clock, from formatIstClock
}

/** UTC instant as an IST clock on the journey's day count */
export function formatJourneyClock(journeyDate: IsoDate, at: IsoUtc): string {
  const minute = utcToTimetableMinute(journeyDate, at); // minutes from midnight IST on day 1, from utcToTimetableMinute
  return formatTimetableMinute(minute);
}

/** Arrival window as IST clocks, with the day after day 1 */
export function formatWindow(journeyDate: IsoDate, window: ArrivalWindow): string {
  const start = utcToTimetableMinute(journeyDate, window.windowStart); // minutes from midnight IST on day 1, from utcToTimetableMinute
  const end = utcToTimetableMinute(journeyDate, window.windowEnd); // minutes from midnight IST on day 1, from utcToTimetableMinute
  return `${formatIstClock(start)}–${formatTimetableMinute(end)}`;
}

/** Journey date as a weekday and date */
export function formatJourneyDate(journeyDate: IsoDate): string {
  const midnight = timetableMinuteToUtc(journeyDate, 0); // midnight IST as a UTC instant, from timetableMinuteToUtc
  return formatIstDate(midnight, JOURNEY_DATE_PARTS);
}

/** UTC instant as an IST clock */
export function formatClock(at: IsoUtc): string {
  const minute = utcToTimetableMinute(istDateOf(at), at); // minutes from midnight IST on its own date, from utcToTimetableMinute
  return formatIstClock(minute);
}

/** How long before now an instant was, in the largest whole unit */
export function formatAgo(at: IsoUtc, now: IsoUtc): string {
  const minutes = minutesBetween(at, now); // whole minutes from at to now, from minutesBetween
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < MINUTES_PER_HOUR) {
    return `${minutes} min ago`;
  }
  if (minutes < MINUTES_PER_DAY) {
    return `${Math.floor(minutes / MINUTES_PER_HOUR)} h ago`;
  }
  return `${Math.floor(minutes / MINUTES_PER_DAY)} d ago`;
}

/** Delay in words */
export function formatDelay(delayMin: number): string {
  if (delayMin > 0) {
    return `${delayMin} min late`;
  }
  return delayMin < -1 ? `${-delayMin} min early` : 'On time';
}

/** Colour class for a delay */
export function delayTone(delayMin: number): 'ok' | 'warn' | 'late' {
  if (delayMin <= 0) {
    return 'ok';
  }
  return delayMin <= MINOR_DELAY_MIN ? 'warn' : 'late';
}

/** Pace as a share faster or slower than the timetable */
export function formatPace(pace: number): string {
  const percent = Math.round(Math.abs(pace - 1) * 100);
  if (percent === 0) {
    return 'On the timetable';
  }
  return `${percent}% ${pace < 1 ? 'faster' : 'slower'} than the timetable`;
}

/** Distance in whole kilometres with Indian digit grouping */
export function formatKm(distanceKm: number): string {
  return `${Math.round(distanceKm).toLocaleString('en-IN')} km`;
}
