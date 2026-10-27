// Features: what is left of the monthly quota, the verdict

import { assert } from '../types.js';

const NOTHING_LEFT = 0;

export type QuotaReason = 'allowed' | 'quota_spent';

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
