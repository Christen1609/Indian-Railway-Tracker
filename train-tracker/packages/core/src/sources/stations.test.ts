import { describe, expect, it } from 'vitest';
import { canonicalStationCode, matchHalt } from './stations.js';
import type { OurHalt } from './stations.js';

const HALTS: OurHalt[] = [
  { code: 'BCT', lat: 18.970667, lon: 72.819383 },
  { code: 'BVI', lat: 19.228739, lon: 72.856412 },
  { code: 'ST', lat: 21.206568, lon: 72.840793 },
];
const NO_NEIGHBOURS = { prev: null, next: null };

describe('canonicalStationCode', () => {
  it('rewrites the codes sources disagree on', () => {
    expect(canonicalStationCode('MMCT')).toBe('BCT');
    expect(canonicalStationCode('NKOT')).toBe('DKNT');
  });

  it('leaves every other code alone', () => {
    for (const code of ['BVI', 'ST', 'BRC', 'RTM', 'NAD', 'KOTA', 'NDLS', 'PR', 'EPR']) {
      expect(canonicalStationCode(code)).toBe(code);
    }
  });
});

describe('matchHalt', () => {
  it('matches the halt of that order when the coordinates sit within 2 km', () => {
    const place = { haltOrder: 1, lat: 19.2297, lon: 72.8571 };
    expect(matchHalt(place, HALTS, NO_NEIGHBOURS)).toBe('BVI');
  });

  it('refuses coordinates more than 2 km away, even at the right order', () => {
    const place = { haltOrder: 1, lat: 19.26, lon: 72.8564 };
    expect(matchHalt(place, HALTS, NO_NEIGHBOURS)).toBeNull();
  });

  it('refuses coordinates that fit a halt of another order', () => {
    const place = { haltOrder: 2, lat: 19.2297, lon: 72.8571 };
    expect(matchHalt(place, HALTS, NO_NEIGHBOURS)).toBeNull();
  });

  it('without coordinates, matches when both neighbouring halts match', () => {
    expect(matchHalt({ haltOrder: 1 }, HALTS, { prev: 'BCT', next: 'ST' })).toBe('BVI');
  });

  it('without coordinates, refuses when a neighbour is missing or different', () => {
    expect(matchHalt({ haltOrder: 1 }, HALTS, { prev: 'BCT', next: null })).toBeNull();
    expect(matchHalt({ haltOrder: 1 }, HALTS, { prev: 'BCT', next: 'BRC' })).toBeNull();
    expect(matchHalt({ haltOrder: 0 }, HALTS, { prev: null, next: 'BVI' })).toBeNull();
  });

  it('refuses an order we have no halt for', () => {
    expect(matchHalt({ haltOrder: 9, lat: 19.2, lon: 72.8 }, HALTS, NO_NEIGHBOURS)).toBeNull();
  });
});
