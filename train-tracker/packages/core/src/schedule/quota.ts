// Features: the pot a run spends from, the paced allowance, the verdict

import { istMonthProgress } from '../time.js';
import { assert } from '../types.js';
import type { IsoUtc } from '../types.js';

const NOTHING_LEFT = 0;

export type QuotaReason = 'allowed' | 'quota_paced' | 'quota_spent';

export type QuotaInput = {
  monthlyBudget: number;
  demoReserve: number;
  spentThisMonth: number;
  isDemo: boolean;
  now: IsoUtc;
};

export type QuotaVerdict = {
  spend: boolean;
  reason: QuotaReason;
  allowance: number;
  left: number;
};

/** Whether a source may be called, and what is left of the pot this run spends from */
export function quotaCheck(input: QuotaInput): QuotaVerdict {
  const { monthlyBudget, demoReserve, spentThisMonth, isDemo } = input;
  assert(monthlyBudget >= NOTHING_LEFT, `a monthly budget of zero or more, got ${monthlyBudget}`);
  assert(
    demoReserve >= NOTHING_LEFT && demoReserve <= monthlyBudget,
    `a demo reserve inside the budget, got ${demoReserve} of ${monthlyBudget}`,
  );
  assert(spentThisMonth >= NOTHING_LEFT, `calls spent of zero or more, got ${spentThisMonth}`);

  const pot = isDemo ? monthlyBudget : monthlyBudget - demoReserve;
  const { day, days } = istMonthProgress(input.now); // how far through the month, from istMonthProgress
  const allowance = isDemo ? pot : Math.floor((pot * day) / days);
  const left = Math.max(NOTHING_LEFT, pot - spentThisMonth);

  if (left === NOTHING_LEFT) {
    return { spend: false, reason: 'quota_spent', allowance, left };
  }
  return spentThisMonth >= allowance
    ? { spend: false, reason: 'quota_paced', allowance, left }
    : { spend: true, reason: 'allowed', allowance, left };
}
