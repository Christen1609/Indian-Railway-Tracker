import { describe, expect, it } from 'vitest';
import type { TimetableStop } from '../types.js';
import { quotaCheck, railRadarPlan } from './quota.js';
import type { RailRadarInput, RailRadarVerdict } from './quota.js';

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

const RESERVE = 20;
const JOURNEY_DATE = '2026-10-29';
const WINDOW_START = '2026-10-29T15:49:00.000Z';
const NOW = '2026-10-29T15:55:00.000Z';
const AFTER_MIDNIGHT = '2026-10-29T19:10:00.000Z';
const MIDNIGHT_WINDOW_START = '2026-10-29T19:00:00.000Z';

const STOPS: TimetableStop[] = [
  { seq: 0, stationCode: 'BCT', km: 0, schedArrMin: null, schedDepMin: 1020 },
  { seq: 1, stationCode: 'BVI', km: 30, schedArrMin: 1040, schedDepMin: 1042 },
  { seq: 2, stationCode: 'ST', km: 263, schedArrMin: 1183, schedDepMin: 1188 },
  { seq: 3, stationCode: 'BRC', km: 392, schedArrMin: 1266, schedDepMin: 1276 },
  { seq: 4, stationCode: 'RTM', km: 653, schedArrMin: 1465, schedDepMin: 1468 },
  { seq: 5, stationCode: 'NAD', km: 695, schedArrMin: 1508, schedDepMin: 1510 },
  { seq: 6, stationCode: 'KOTA', km: 920, schedArrMin: 1635, schedDepMin: 1640 },
  { seq: 7, stationCode: 'NDLS', km: 1384, schedArrMin: 1952, schedDepMin: null },
].map((stop) => ({ ...stop, trainNumber: '12951' }));

/** A due arrival on a watched trip with healthy scrapes and nothing spent, with any part replaced */
function plan(over: Partial<RailRadarInput> = {}): RailRadarVerdict {
  return railRadarPlan({
    monthlyBudget: MONTHLY_BUDGET,
    demoReserve: RESERVE,
    spentThisMonth: 0,
    callsThisJourney: 0,
    stops: STOPS,
    journeyDate: JOURNEY_DATE,
    now: NOW,
    check: 'window_open',
    isScored: false,
    allScrapesFailed: false,
    lastAskedAt: null,
    windowStart: WINDOW_START,
    ...over,
  });
}

describe('railRadarPlan, a watched trip', () => {
  it('does not ask while the scrapes are working', () => {
    expect(plan()).toEqual({ ask: false, reason: 'scrapes_ok' });
  });

  it('asks as a fallback when every scrape failed for a due arrival', () => {
    expect(plan({ allScrapesFailed: true })).toEqual({ ask: true, reason: 'fallback' });
  });

  it('asks for a late arrival too', () => {
    expect(plan({ allScrapesFailed: true, check: 'late' }).ask).toBe(true);
  });

  it.each(['catch_up', 'departure'] as const)(
    'does not ask on a %s check, which is not an arrival',
    (check) => {
      expect(plan({ allScrapesFailed: true, check })).toEqual({ ask: false, reason: 'not_due' });
    },
  );
});

describe('railRadarPlan, a scored trip', () => {
  it('asks at each due arrival even when the scrapes are working', () => {
    expect(plan({ isScored: true })).toEqual({ ask: true, reason: 'scored' });
  });

  it('does not ask on a departure check', () => {
    expect(plan({ isScored: true, check: 'departure' }).ask).toBe(false);
  });
});

describe('railRadarPlan, one call per timetabled arrival', () => {
  it('counts 7 arrivals on 12951, none at the origin', () => {
    expect(plan({ isScored: true, callsThisJourney: 6 }).ask).toBe(true);
    expect(plan({ isScored: true, callsThisJourney: 7 })).toEqual({
      ask: false,
      reason: 'journey_cap',
    });
  });

  it('holds the same limit for a fallback', () => {
    expect(plan({ allScrapesFailed: true, callsThisJourney: 7 }).reason).toBe('journey_cap');
    expect(plan({ allScrapesFailed: true, callsThisJourney: 6 }).ask).toBe(true);
  });

  it('takes the count from the timetable, so a shorter route has a lower cap', () => {
    const short = STOPS.slice(0, 3);
    expect(plan({ isScored: true, stops: short, callsThisJourney: 2 }).reason).toBe('journey_cap');
    expect(plan({ isScored: true, stops: short, callsThisJourney: 1 }).ask).toBe(true);
  });
});

describe('railRadarPlan, once per window', () => {
  it('does not ask again for an arrival it already asked about', () => {
    const lastAskedAt = '2026-10-29T15:50:00.000Z';
    expect(plan({ isScored: true, lastAskedAt })).toEqual({ ask: false, reason: 'already_asked' });
    expect(plan({ allScrapesFailed: true, lastAskedAt }).reason).toBe('already_asked');
  });

  it('asks again once a new window has opened after the last call', () => {
    const lastAskedAt = '2026-10-29T15:30:00.000Z';
    expect(plan({ isScored: true, lastAskedAt }).ask).toBe(true);
  });

  it('counts a call made at the very moment the window opened', () => {
    expect(plan({ isScored: true, lastAskedAt: WINDOW_START }).reason).toBe('already_asked');
  });
});

describe('railRadarPlan, after midnight on a journey that left the day before', () => {
  const after = { now: AFTER_MIDNIGHT, windowStart: MIDNIGHT_WINDOW_START };

  it('asks only if every scrape failed, even on a scored trip', () => {
    expect(plan({ ...after, isScored: true })).toEqual({ ask: false, reason: 'scrapes_ok' });
    expect(plan({ ...after, isScored: true, allScrapesFailed: true })).toEqual({
      ask: true,
      reason: 'fallback',
    });
  });

  it('still asks a scored trip before midnight, with the scrapes working', () => {
    expect(plan({ isScored: true }).reason).toBe('scored');
  });

  it('asks at most once per remaining window', () => {
    const input = { ...after, allScrapesFailed: true };
    expect(plan({ ...input, lastAskedAt: '2026-10-29T19:05:00.000Z' }).reason).toBe(
      'already_asked',
    );
    expect(plan({ ...input, lastAskedAt: '2026-10-29T18:00:00.000Z' }).ask).toBe(true);
  });
});

describe('railRadarPlan, the monthly reserve', () => {
  const spendable = MONTHLY_BUDGET - RESERVE;

  it('lets a scored trip spend up to the reserve and no further', () => {
    expect(plan({ isScored: true, spentThisMonth: spendable - 1 }).ask).toBe(true);
    expect(plan({ isScored: true, spentThisMonth: spendable })).toEqual({
      ask: false,
      reason: 'reserve_held',
    });
  });

  it('lets a fallback spend the reserve', () => {
    expect(plan({ allScrapesFailed: true, spentThisMonth: spendable }).ask).toBe(true);
    expect(plan({ allScrapesFailed: true, spentThisMonth: MONTHLY_BUDGET - 1 }).ask).toBe(true);
  });

  it('lets a scored trip whose scrapes all failed spend the reserve too', () => {
    const verdict = plan({ isScored: true, allScrapesFailed: true, spentThisMonth: spendable });
    expect(verdict).toEqual({ ask: true, reason: 'fallback' });
  });

  it('stops everything when the month is spent', () => {
    expect(plan({ allScrapesFailed: true, spentThisMonth: MONTHLY_BUDGET })).toEqual({
      ask: false,
      reason: 'quota_spent',
    });
    expect(plan({ isScored: true, spentThisMonth: MONTHLY_BUDGET }).reason).toBe('quota_spent');
  });

  it('treats a reserve larger than the budget as no spendable budget, not an error', () => {
    expect(plan({ isScored: true, demoReserve: 500 }).reason).toBe('reserve_held');
  });
});
