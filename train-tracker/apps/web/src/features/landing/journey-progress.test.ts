import { describe, expect, it } from 'vitest';
import type { TimetableStop, TrainState } from '@train-tracker/core/types';
import { journeyProgress } from './journey-progress';

const STOP = { trainNumber: '12951', schedArrMin: null, schedDepMin: null };
const STOPS: TimetableStop[] = [
  { ...STOP, seq: 1, stationCode: 'BCT', km: 0 },
  { ...STOP, seq: 2, stationCode: 'ST', km: 250 },
  { ...STOP, seq: 3, stationCode: 'NDLS', km: 1000 },
];
const STATE: TrainState = {
  journeyId: 'j1',
  state: 'running',
  km: 500,
  loKm: 495,
  hiKm: 505,
  pace: 1,
  delayMin: 0,
  nextStation: 'NDLS',
  window: null,
  nextCheckAt: null,
  updatedAt: '2026-10-27T10:00:00.000Z',
};

describe('journeyProgress', () => {
  it.each([
    ['running shows the fraction and a dot', { ...STATE }, 0.5, 500, true],
    ['halted shows a dot', { ...STATE, state: 'halted' as const }, 0.5, 500, true],
    ['late shows a dot', { ...STATE, state: 'late' as const, km: 250 }, 0.25, 250, true],
    ['arrived is full with no dot', { ...STATE, state: 'arrived' as const }, 1, 1000, false],
    ['not started is empty', { ...STATE, state: 'scheduled' as const }, 0, 0, false],
    ['no state is empty', null, 0, 0, false],
    ['a km past the end stops at the end', { ...STATE, km: 1200 }, 1, 1000, true],
    ['a km before the start stops at the start', { ...STATE, km: -5 }, 0, 0, true],
  ])('%s', (_name, state, fraction, doneKm, hasDot) => {
    const progress = journeyProgress(STOPS, state);
    expect(progress.fraction).toBe(fraction);
    expect(progress.doneKm).toBe(doneKm);
    expect(progress.hasDot).toBe(hasDot);
    expect(progress.totalKm).toBe(1000);
  });

  it('ticks only the stops between the ends', () => {
    expect(journeyProgress(STOPS, null).ticks).toEqual([0.25]);
  });

  it('is empty when there are no stops', () => {
    expect(journeyProgress([], STATE)).toEqual({
      fraction: 0,
      doneKm: 0,
      totalKm: 0,
      ticks: [],
      hasDot: false,
    });
  });
});
