// Features: which run of a train is the one to follow now

import { istDateOf, plusDays, plusMinutes, secondsBetween, timetableMinuteToUtc } from '../time.js';
import { assert } from '../types.js';
import type { IsoDate, IsoUtc, JourneyStatus, TimetableStop } from '../types.js';

const YESTERDAY = -1;
const MIN_PER_HOUR = 60;
const NOT_YET = 0;

export const LATE_RUN_GRACE_HOURS = 6;

export type RunDateInput = {
  stops: readonly TimetableStop[];
  now: IsoUtc;
  yesterday: JourneyStatus | null;
};

/** The IST date the run to follow left, or will leave, its origin: yesterday's while it is on the line, else today's */
export function currentRunDate(input: RunDateInput): IsoDate {
  const today = istDateOf(input.now); // the IST date, from istDateOf
  if (input.yesterday === 'arrived' || input.yesterday === 'cancelled') {
    return today;
  }
  const finalArrivalMin = input.stops[input.stops.length - 1]?.schedArrMin;
  assert(finalArrivalMin != null, 'a timetabled final arrival');

  const yesterday = plusDays(today, YESTERDAY); // the day before, from plusDays
  const scheduled = timetableMinuteToUtc(yesterday, finalArrivalMin); // when it was due, from timetableMinuteToUtc
  const graceEnds = plusMinutes(scheduled, LATE_RUN_GRACE_HOURS * MIN_PER_HOUR); // when we give up on it, from plusMinutes
  return secondsBetween(input.now, graceEnds) > NOT_YET ? yesterday : today;
}
