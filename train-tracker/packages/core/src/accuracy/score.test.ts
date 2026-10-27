import { describe, expect, it } from 'vitest';
import { medianMin, windowHits } from './score.js';
import type { LoggedWindow } from './score.js';

const KOTA = 'KOTA';

/** A window we were showing, published at a lead time before the arrival */
function published(leadMin: number, startMin: number, endMin: number): LoggedWindow {
  const base = Date.parse('2026-10-21T22:00:00.000Z');
  const minute = (offset: number): string => new Date(base + offset * 60_000).toISOString();
  return { at: minute(-leadMin), windowStart: minute(startMin), windowEnd: minute(endMin) };
}

const ARRIVED_AT = '2026-10-21T22:00:00.000Z';

describe('windowHits, grading one arrival against every window we showed', () => {
  it('scores a hit when the arrival lands inside the window', () => {
    const hits = windowHits(KOTA, ARRIVED_AT, [published(60, -5, 10)]);
    expect(hits).toEqual([
      {
        stationCode: KOTA,
        publishedAt: '2026-10-21T21:00:00.000Z',
        arrivedAt: ARRIVED_AT,
        windowStart: '2026-10-21T21:55:00.000Z',
        windowEnd: '2026-10-21T22:10:00.000Z',
        hit: true,
        widthMin: 15,
        leadMin: 60,
      },
    ]);
  });

  it('scores a miss when the train arrives before the window opens', () => {
    const hits = windowHits(KOTA, ARRIVED_AT, [published(60, 5, 20)]);
    expect(hits[0]?.hit).toBe(false);
  });

  it('scores a miss when the train arrives after the window closes', () => {
    const hits = windowHits(KOTA, ARRIVED_AT, [published(60, -30, -5)]);
    expect(hits[0]?.hit).toBe(false);
  });

  it('counts landing exactly on either edge as a hit', () => {
    expect(windowHits(KOTA, ARRIVED_AT, [published(60, 0, 10)])[0]?.hit).toBe(true);
    expect(windowHits(KOTA, ARRIVED_AT, [published(60, -10, 0)])[0]?.hit).toBe(true);
  });

  it('keeps one row per window we showed, each with its own lead time', () => {
    const hits = windowHits(KOTA, ARRIVED_AT, [
      published(180, -20, 25),
      published(60, -8, 12),
      published(10, -2, 4),
    ]);
    expect(hits.map((one) => one.leadMin)).toEqual([180, 60, 10]);
    expect(hits.map((one) => one.widthMin)).toEqual([45, 20, 6]);
    expect(hits.every((one) => one.hit)).toBe(true);
  });

  it('shows a narrowing window as the train gets closer, which is the point of the lead time', () => {
    const hits = windowHits(KOTA, ARRIVED_AT, [published(180, -20, 25), published(10, -2, 4)]);
    const [far, near] = hits;
    expect(far?.widthMin).toBeGreaterThan(near?.widthMin ?? 0);
  });

  it('ignores a window published after the train had already arrived', () => {
    const late = published(-5, -2, 4);
    expect(windowHits(KOTA, ARRIVED_AT, [late])).toEqual([]);
  });

  it('has nothing to say when we never published a window', () => {
    expect(windowHits(KOTA, ARRIVED_AT, [])).toEqual([]);
  });
});

describe('medianMin', () => {
  it('takes the middle of an odd number of widths', () => {
    expect(medianMin([30, 10, 20])).toBe(20);
  });

  it('averages the middle two of an even number', () => {
    expect(medianMin([10, 20, 30, 40])).toBe(25);
  });

  it('is zero when there is nothing to measure', () => {
    expect(medianMin([])).toBe(0);
  });
});
