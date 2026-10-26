import { describe, expect, it } from 'vitest';
import { quotaCheck } from './quota.js';
import type { QuotaInput } from './quota.js';

const MONTHLY_BUDGET = 100;
const DEMO_RESERVE = 55;
const DEV_POT = MONTHLY_BUDGET - DEMO_RESERVE;
const SCORED_TRIP_CALLS = 25;
const DEMO_CALLS = 6;

/** A day in October 2026, which has 31 days, at noon IST */
const onDay = (day: number): string => `2026-10-${String(day).padStart(2, '0')}T06:30:00.000Z`;

/** The RailRadar pots from DATA_SOURCES.md, with any part replaced */
function input(over: Partial<QuotaInput> = {}): QuotaInput {
  return {
    monthlyBudget: MONTHLY_BUDGET,
    demoReserve: DEMO_RESERVE,
    spentThisMonth: 0,
    isDemo: false,
    now: onDay(15),
    ...over,
  };
}

describe('quotaCheck, pacing development spend over the month', () => {
  it('lets development spend only its share of the pot by this day', () => {
    expect(quotaCheck(input({ now: onDay(1) })).allowance).toBe(Math.floor((DEV_POT * 1) / 31));
    expect(quotaCheck(input({ now: onDay(15) })).allowance).toBe(Math.floor((DEV_POT * 15) / 31));
    expect(quotaCheck(input({ now: onDay(31) })).allowance).toBe(DEV_POT);
  });

  it('allows a call while spend is behind the allowance', () => {
    const verdict = quotaCheck(input({ spentThisMonth: 20 }));
    expect(verdict).toMatchObject({ spend: true, reason: 'allowed' });
  });

  it('holds a call back once spend has caught the allowance', () => {
    const verdict = quotaCheck(input({ spentThisMonth: 21 }));
    expect(verdict).toMatchObject({ spend: false, reason: 'quota_paced' });
    expect(verdict.left).toBeGreaterThan(0);
  });

  it('never lets development reach into the demo reserve', () => {
    const verdict = quotaCheck(input({ spentThisMonth: DEV_POT, now: onDay(31) }));
    expect(verdict).toMatchObject({ spend: false, reason: 'quota_spent', left: 0 });
  });

  it('counts a shorter month as a faster allowance', () => {
    const february = quotaCheck(input({ now: '2026-02-14T06:30:00.000Z' }));
    expect(february.allowance).toBe(Math.floor((DEV_POT * 14) / 28));
  });
});

describe('quotaCheck, the demo pot', () => {
  const demo = { isDemo: true };

  it('gives a demo the whole budget, with no pacing', () => {
    const verdict = quotaCheck(input({ ...demo, now: onDay(1) }));
    expect(verdict.allowance).toBe(MONTHLY_BUDGET);
    expect(verdict.spend).toBe(true);
  });

  it('still has the reserve left after development has spent its pot', () => {
    const verdict = quotaCheck(input({ ...demo, spentThisMonth: DEV_POT }));
    expect(verdict).toMatchObject({ spend: true, reason: 'allowed', left: DEMO_RESERVE });
  });

  it('stops once the whole budget is gone', () => {
    const verdict = quotaCheck(input({ ...demo, spentThisMonth: MONTHLY_BUDGET }));
    expect(verdict).toMatchObject({ spend: false, reason: 'quota_spent', left: 0 });
  });
});

describe('quotaCheck, against the budget table in DATA_SOURCES.md', () => {
  it('fits one scored trip inside the development pot by the middle of the month', () => {
    const earliest = [...Array(31).keys()]
      .map((index) => index + 1)
      .find((day) => quotaCheck(input({ now: onDay(day) })).allowance >= SCORED_TRIP_CALLS);
    expect(earliest).toBe(18);
  });

  it('leaves room for nine demos in the reserve', () => {
    expect(Math.floor(DEMO_RESERVE / DEMO_CALLS)).toBe(9);
  });

  it('reports what is left so preflight can print it', () => {
    expect(quotaCheck(input({ spentThisMonth: 12 })).left).toBe(DEV_POT - 12);
  });
});
