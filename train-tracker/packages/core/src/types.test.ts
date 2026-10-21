import { describe, expect, it } from 'vitest';
import { assert } from './types.js';

describe('assert', () => {
  it('passes a true condition', () => {
    expect(() => assert(true, 'windowStart <= windowEnd')).not.toThrow();
  });

  it('names what was expected when it throws', () => {
    expect(() => assert(false, 'loKm <= km')).toThrow('Invariant broken. Expected loKm <= km');
  });

  it('throws on a falsy value', () => {
    expect(() => assert(0, 'km is set')).toThrow();
    expect(() => assert(null, 'nextStation is set')).toThrow();
    expect(() => assert('', 'stationCode is set')).toThrow();
  });

  it('narrows the type it asserts on', () => {
    const nextStation: string | null = 'BRC';
    assert(nextStation, 'nextStation is set');
    expect(nextStation.length).toBe(3);
  });
});
