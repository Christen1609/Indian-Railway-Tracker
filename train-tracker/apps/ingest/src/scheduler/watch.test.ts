import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HEALTHY } from '@train-tracker/core/schedule/health';
import { timetableMinuteToUtc } from '@train-tracker/core/time';
import type { Config } from '../config.js';
import { callsThisMonth, latestJourneyFor, stateFor, timetableFor } from '../db/journey-data.js';
import { healthFor } from '../db/source-health.js';
import { checkJourney } from './check-journey.js';
import type { CheckOutcome } from './check-journey.js';
import { watchRound } from './watch.js';
import type { Run } from './watch.js';

vi.mock('../db/journey-data.js');
vi.mock('../db/source-health.js');
vi.mock('../log.js');
vi.mock('./check-journey.js');

const TRAIN = '12951';
const JOURNEY_DATE = '2026-10-27';
const NOW = '2026-10-28T06:00:00.000Z';
const NEXT_DEPARTURE_CHECK = timetableMinuteToUtc('2026-10-28', 1022);
const LATER = '2026-10-28T07:00:00.000Z';

const JOURNEY = { id: 'j1', journeyDate: JOURNEY_DATE };
const STOP = {
  trainNumber: TRAIN,
  seq: 0,
  stationCode: 'BCT',
  schedArrMin: null,
  schedDepMin: 1020,
  km: 0,
};
const OUTCOME: CheckOutcome = {
  journeyId: 'j1',
  journeyDate: JOURNEY_DATE,
  nextCheckAt: LATER,
  confirmed: 1,
  rejected: 0,
};

/** A fresh watching session with a monthly budget of 100 */
function session(): Run {
  const config = {
    db: { url: 'http://db', serviceRoleKey: 'k' },
    quota: { monthlyBudget: 100 },
    intervals: { windowMin: 5, lateMin: [5], departureDelayMin: 2 },
  } as unknown as Config;
  return { config, watchingSince: NOW, holds: new Map() };
}

/** Moves the fake clock on by this many minutes */
function advanceMin(minutes: number): void {
  vi.setSystemTime(new Date(Date.now() + minutes * 60_000));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ now: new Date(NOW) });
  vi.mocked(latestJourneyFor).mockResolvedValue(JOURNEY);
  vi.mocked(stateFor).mockResolvedValue({ nextCheckAt: NOW, updatedAt: NOW });
  vi.mocked(timetableFor).mockResolvedValue([STOP]);
  vi.mocked(healthFor).mockResolvedValue(HEALTHY);
  vi.mocked(callsThisMonth).mockResolvedValue(0);
  vi.mocked(checkJourney).mockResolvedValue(OUTCOME);
});

describe('watchRound', () => {
  it('says when the next check is due', async () => {
    await expect(watchRound([TRAIN], session())).resolves.toBe(LATER);
    expect(checkJourney).toHaveBeenCalledOnce();
  });

  it('keeps watching after an unreadable response, leaving the wait to the source health', async () => {
    vi.mocked(checkJourney).mockResolvedValue(null);
    await expect(watchRound([TRAIN], session())).resolves.toBe(NOW);
  });

  it('keeps watching after a pass throws, and comes back after the first backoff', async () => {
    vi.mocked(checkJourney).mockRejectedValue(new Error('Supabase returned 500'));
    await expect(watchRound([TRAIN], session())).resolves.toBe('2026-10-28T06:01:00.000Z');
  });

  it('holds a failing train back longer each time, so it cannot spin on the source', async () => {
    vi.mocked(checkJourney).mockRejectedValue(new Error('Supabase returned 500'));
    const run = session();

    await watchRound([TRAIN], run);
    advanceMin(0.5);
    await watchRound([TRAIN], run);
    expect(checkJourney).toHaveBeenCalledOnce();

    advanceMin(0.5);
    await expect(watchRound([TRAIN], run)).resolves.toBe('2026-10-28T06:03:00.000Z');
    expect(checkJourney).toHaveBeenCalledTimes(2);
  });

  it('forgets the failures once a check gets through', async () => {
    vi.mocked(checkJourney).mockRejectedValueOnce(new Error('Supabase returned 500'));
    const run = session();

    await watchRound([TRAIN], run);
    advanceMin(1);
    await watchRound([TRAIN], run);
    expect(run.holds.size).toBe(0);
  });

  it('waits for the next departure when the newest journey has arrived', async () => {
    vi.mocked(stateFor).mockResolvedValue({ nextCheckAt: null, updatedAt: NOW });
    await expect(watchRound([TRAIN], session())).resolves.toBe(NEXT_DEPARTURE_CHECK);
    expect(checkJourney).not.toHaveBeenCalled();
  });

  it('checks at once when the next departure passed while the worker was off', async () => {
    vi.mocked(stateFor).mockResolvedValue({
      nextCheckAt: null,
      updatedAt: '2026-10-28T03:00:00.000Z',
    });
    vi.setSystemTime(new Date('2026-11-02T06:00:00.000Z'));
    await watchRound([TRAIN], session());
    expect(checkJourney).toHaveBeenCalledOnce();
  });

  it('looks straight back after the arrival, to work out the next departure', async () => {
    vi.mocked(checkJourney).mockResolvedValue({ ...OUTCOME, nextCheckAt: null });
    await expect(watchRound([TRAIN], session())).resolves.toBe(NOW);
  });

  it('gives up on a train only when the monthly budget is spent', async () => {
    vi.mocked(callsThisMonth).mockResolvedValue(100);
    await expect(watchRound([TRAIN], session())).resolves.toBeNull();
    expect(checkJourney).not.toHaveBeenCalled();
  });

  it('checks the other trains when one fails', async () => {
    vi.mocked(checkJourney).mockRejectedValueOnce(new Error('Supabase returned 500'));
    await expect(watchRound(['12951', '12952'], session())).resolves.toBe(
      '2026-10-28T06:01:00.000Z',
    );
    expect(checkJourney).toHaveBeenCalledTimes(2);
  });
});
