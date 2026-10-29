import { describe, expect, it } from 'vitest';
import type { TrainState } from '@train-tracker/core/types';
import { isAwaitingNews, pickSearchingWord } from './searching';

const START = '2026-10-27T10:00:00.000Z';
const END = '2026-10-27T10:20:00.000Z';
const BASE: TrainState = {
  journeyId: 'journey-1',
  nextCheckAt: null,
  updatedAt: '2026-10-27T09:00:00.000Z',
  state: 'running',
  km: 700,
  loKm: 690,
  hiKm: 710,
  pace: 1,
  delayMin: 0,
  nextStation: 'RTM',
  window: { windowStart: START, windowEnd: END },
};

describe('isAwaitingNews', () => {
  it.each([
    ['scheduled', { state: 'scheduled' as const }, START, false],
    ['arrived', { state: 'arrived' as const }, END, false],
    ['no window', { window: null }, END, false],
    ['no next station', { nextStation: null }, END, false],
    ['before the window', {}, '2026-10-27T09:59:59.000Z', false],
    ['at the window start', {}, START, true],
    ['inside the window', {}, '2026-10-27T10:10:00.000Z', true],
    ['after the window', {}, '2026-10-27T10:45:00.000Z', true],
    ['halted and due', { state: 'halted' as const }, END, true],
  ])('%s', (_name, patch, now, expected) => {
    expect(isAwaitingNews({ ...BASE, ...patch }, now)).toBe(expected);
  });
});

describe('pickSearchingWord', () => {
  const words = ['a', 'b', 'c'];

  it('stays put within a 3 second step', () => {
    const first = pickSearchingWord('2026-10-27T10:00:00.000Z', words);
    expect(pickSearchingWord('2026-10-27T10:00:02.999Z', words)).toBe(first);
  });

  it('moves on at the next step', () => {
    const first = pickSearchingWord('2026-10-27T10:00:00.000Z', words);
    expect(pickSearchingWord('2026-10-27T10:00:03.000Z', words)).not.toBe(first);
  });

  it('wraps around the list', () => {
    const at = (step: number) => new Date(step * 3000).toISOString();
    expect(pickSearchingWord(at(0), words)).toBe('a');
    expect(pickSearchingWord(at(2), words)).toBe('c');
    expect(pickSearchingWord(at(3), words)).toBe('a');
  });

  it('uses the shipped word list by default', () => {
    expect(pickSearchingWord('1970-01-01T00:00:00.000Z')).toBe('Searching');
  });
});
