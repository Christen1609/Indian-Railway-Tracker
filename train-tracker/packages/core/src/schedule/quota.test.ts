import { describe, expect, it } from 'vitest';
import { quotaCheck } from './quota.js';

const MONTHLY_BUDGET = 100;
const TRIP_CALLS = 22;

describe('quotaCheck, spending the month freely', () => {
  it('allows a call on the first day of the month', () => {
    expect(quotaCheck({ monthlyBudget: MONTHLY_BUDGET, spentThisMonth: 0 })).toEqual({
      spend: true,
      reason: 'allowed',
      left: MONTHLY_BUDGET,
    });
  });

  it('allows four whole journeys back to back, with no pacing in the way', () => {
    const spentThisMonth = TRIP_CALLS * 4;
    expect(quotaCheck({ monthlyBudget: MONTHLY_BUDGET, spentThisMonth })).toMatchObject({
      spend: true,
      left: MONTHLY_BUDGET - spentThisMonth,
    });
  });

  it('allows the very last call', () => {
    expect(
      quotaCheck({ monthlyBudget: MONTHLY_BUDGET, spentThisMonth: MONTHLY_BUDGET - 1 }).spend,
    ).toBe(true);
  });

  it('stops only once the provider would refuse us anyway', () => {
    expect(quotaCheck({ monthlyBudget: MONTHLY_BUDGET, spentThisMonth: MONTHLY_BUDGET })).toEqual({
      spend: false,
      reason: 'quota_spent',
      left: 0,
    });
  });

  it('never reports a negative number of calls left', () => {
    expect(quotaCheck({ monthlyBudget: MONTHLY_BUDGET, spentThisMonth: 500 }).left).toBe(0);
  });

  it('reports what is left, so the worker can log it', () => {
    expect(quotaCheck({ monthlyBudget: MONTHLY_BUDGET, spentThisMonth: TRIP_CALLS }).left).toBe(78);
  });
});
