// Features: what is left of the monthly quota, the verdict, whether RailRadar is worth a call

import { istDateOf, secondsBetween } from '../time.js';
import { assert } from '../types.js';
import type { IsoDate, IsoUtc, TimetableStop } from '../types.js';
import type { CheckReason } from './next-check.js';

const NOTHING_LEFT = 0;
const ARRIVAL_CHECKS: readonly CheckReason[] = ['window_open', 'late'];
const WINDOW_OPENED = 0;

export type QuotaReason = 'allowed' | 'quota_spent';

export type RailRadarReason =
  | 'scored'
  | 'fallback'
  | 'not_due'
  | 'scrapes_ok'
  | 'already_asked'
  | 'journey_cap'
  | 'reserve_held'
  | 'quota_spent';

export type RailRadarInput = {
  monthlyBudget: number;
  demoReserve: number;
  spentThisMonth: number;
  callsThisJourney: number;
  stops: readonly TimetableStop[];
  journeyDate: IsoDate;
  now: IsoUtc;
  check: CheckReason;
  isScored: boolean;
  allScrapesFailed: boolean;
  lastAskedAt: IsoUtc | null;
  windowStart: IsoUtc | null;
};

export type RailRadarVerdict = { ask: boolean; reason: RailRadarReason };

export type QuotaInput = {
  monthlyBudget: number;
  spentThisMonth: number;
};

export type QuotaVerdict = {
  spend: boolean;
  reason: QuotaReason;
  left: number;
};

/** Whether a source may be called, and how many calls are left this month */
export function quotaCheck(input: QuotaInput): QuotaVerdict {
  const { monthlyBudget, spentThisMonth } = input;
  assert(monthlyBudget >= NOTHING_LEFT, `a monthly budget of zero or more, got ${monthlyBudget}`);
  assert(spentThisMonth >= NOTHING_LEFT, `calls spent of zero or more, got ${spentThisMonth}`);

  const left = Math.max(NOTHING_LEFT, monthlyBudget - spentThisMonth);
  return left === NOTHING_LEFT
    ? { spend: false, reason: 'quota_spent', left }
    : { spend: true, reason: 'allowed', left };
}

/** Whether RailRadar is worth a call for this check: one per timetabled arrival, held to a scored trip or a failed scrape */
export function railRadarPlan(input: RailRadarInput): RailRadarVerdict {
  const refuse = (reason: RailRadarReason): RailRadarVerdict => ({ ask: false, reason });
  if (!ARRIVAL_CHECKS.includes(input.check)) {
    return refuse('not_due');
  }
  const arrivals = input.stops.filter((stop) => stop.schedArrMin !== null).length;
  if (input.callsThisJourney >= arrivals) {
    return refuse('journey_cap');
  }
  const { lastAskedAt, windowStart } = input;
  if (
    lastAskedAt !== null &&
    windowStart !== null &&
    secondsBetween(windowStart, lastAskedAt) >= WINDOW_OPENED
  ) {
    return refuse('already_asked');
  }

  const isPastMidnight = istDateOf(input.now) > input.journeyDate; // the IST day, from istDateOf
  const { monthlyBudget, spentThisMonth } = input;
  if (input.allScrapesFailed) {
    // whether the whole budget has a call left, from quotaCheck
    const budget = quotaCheck({ monthlyBudget, spentThisMonth });
    return budget.spend ? { ask: true, reason: 'fallback' } : refuse('quota_spent');
  }
  if (!input.isScored || isPastMidnight) {
    return refuse('scrapes_ok');
  }

  const spendable = Math.max(NOTHING_LEFT, monthlyBudget - input.demoReserve);
  if (quotaCheck({ monthlyBudget: spendable, spentThisMonth }).spend) {
    return { ask: true, reason: 'scored' };
  }
  // whether only the reserve is left, from quotaCheck
  const hasReserve = quotaCheck({ monthlyBudget, spentThisMonth }).spend;
  return refuse(hasReserve ? 'reserve_held' : 'quota_spent');
}
