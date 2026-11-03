// Features: when a journey ended, the cooling window, what may be deleted

import { minutesBetween, plusMinutes, timetableMinuteToUtc } from '../time.js';
import type { IsoDate, IsoUtc, ResolvedEvent, TimetableStop } from '../types.js';

const ARRIVED_AFTER_HOURS = 2;
const MIN_PER_HOUR = 60;
const NOW_OR_LATER = 0;

export type RetentionReason = 'running' | 'cooling' | 'everything';

export type RetentionInput = {
  journeyDate: IsoDate;
  stops: readonly TimetableStop[];
  confirmed: readonly ResolvedEvent[];
  retentionHours: number;
  now: IsoUtc;
};

export type RetentionVerdict = {
  endedAt: IsoUtc | null;
  clearRaw: boolean;
  deleteDerived: boolean;
  reason: RetentionReason;
};

const RUNNING: RetentionVerdict = {
  endedAt: null,
  clearRaw: false,
  deleteDerived: false,
  reason: 'running',
};

/** When a journey ended: its confirmed final arrival, or long enough after the timetabled one */
function endedAtOf(input: RetentionInput): IsoUtc | null {
  const last = input.stops[input.stops.length - 1];
  if (last === undefined) {
    return null;
  }

  const arrival = input.confirmed.find(
    (event) => event.stationCode === last.stationCode && event.type === 'ARR',
  );
  if (arrival !== undefined) {
    return arrival.at;
  }
  if (last.schedArrMin === null) {
    return null;
  }

  const timetabled = timetableMinuteToUtc(input.journeyDate, last.schedArrMin); // the instant it was due, from timetableMinuteToUtc
  const lapsed = plusMinutes(timetabled, ARRIVED_AFTER_HOURS * MIN_PER_HOUR); // when we give up waiting, from plusMinutes
  return minutesBetween(lapsed, input.now) >= NOW_OR_LATER ? lapsed : null;
}

/** What of a journey's data may go now, and why */
export function retentionCheck(input: RetentionInput): RetentionVerdict {
  const endedAt = endedAtOf(input); // when the journey ended, from endedAtOf
  if (endedAt === null) {
    return RUNNING;
  }

  // when the cooling window is up, from plusMinutes
  const coolUntil = plusMinutes(endedAt, input.retentionHours * MIN_PER_HOUR);
  if (minutesBetween(coolUntil, input.now) < NOW_OR_LATER) {
    return { endedAt, clearRaw: false, deleteDerived: false, reason: 'cooling' };
  }

  return { endedAt, clearRaw: true, deleteDerived: true, reason: 'everything' };
}
