import { describe, expect, it } from 'vitest';
import type { ResolvedEvent, TimetableStop } from '../types.js';
import { arrivalsConfirmed, isThinTrip } from './thin-trip.js';

const STOPS: TimetableStop[] = [
  { seq: 0, stationCode: 'BCT', km: 0, schedArrMin: null, schedDepMin: 1020 },
  { seq: 1, stationCode: 'BRC', km: 392, schedArrMin: 1170, schedDepMin: 1175 },
  { seq: 2, stationCode: 'KOTA', km: 922, schedArrMin: 1635, schedDepMin: 1640 },
  { seq: 3, stationCode: 'NZM', km: 1380, schedArrMin: 1930, schedDepMin: 1935 },
  { seq: 4, stationCode: 'NDLS', km: 1388, schedArrMin: 1952, schedDepMin: null },
].map((stop) => ({ ...stop, trainNumber: '12951' }));

/** One confirmed event */
function event(stationCode: string, type: ResolvedEvent['type']): ResolvedEvent {
  return {
    journeyId: 'j1',
    stationCode,
    type,
    at: '2026-10-27T10:00:00.000Z',
    confidenceScore: 80,
    confidence: 'high',
    chosenSource: 'railradar',
    sources: ['railradar'],
    resolvedAt: '2026-10-27T10:05:00.000Z',
  };
}

describe('arrivalsConfirmed', () => {
  it('expects an arrival at every stop but the origin, and counts an arrival or a pass', () => {
    const counts = arrivalsConfirmed(STOPS, [event('BRC', 'ARR'), event('KOTA', 'PASS')]);
    expect(counts).toEqual({ confirmed: 2, expected: 4 });
  });

  it('does not count a departure, the origin, or a station twice', () => {
    const counts = arrivalsConfirmed(STOPS, [
      event('BRC', 'DEP'),
      event('BCT', 'DEP'),
      event('KOTA', 'ARR'),
      event('KOTA', 'PASS'),
    ]);
    expect(counts.confirmed).toBe(1);
  });
});

describe('isThinTrip', () => {
  it.each([
    ['none confirmed', [], true],
    ['one of four', [event('NDLS', 'ARR')], true],
    ['exactly half', [event('BRC', 'ARR'), event('KOTA', 'ARR')], false],
    ['three of four', [event('BRC', 'ARR'), event('KOTA', 'ARR'), event('NDLS', 'ARR')], false],
  ])('judges %s', (_name, confirmed, expected) => {
    expect(isThinTrip(STOPS, confirmed)).toBe(expected);
  });

  it('says a timetable with no arrivals is not thin', () => {
    expect(isThinTrip(STOPS.slice(0, 1), [])).toBe(false);
  });
});
