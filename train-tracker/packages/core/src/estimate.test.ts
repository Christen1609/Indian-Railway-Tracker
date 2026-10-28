import { describe, expect, it } from 'vitest';
import { capPace, recentPace, sectionCap, sectionPace, sections } from './estimate.js';
import type { TimetableStop } from './types.js';
import { STOPS_12951 as STOPS, TOP_SPEED_KMH } from './testing/journey-12951.js';

describe('sections', () => {
  it('builds one section between each pair of stops', () => {
    expect(sections(STOPS).length).toBe(STOPS.length - 1);
  });

  it('measures each section from the departure before it to the arrival after it', () => {
    expect(sections(STOPS).map((section) => section.timetabledMin)).toEqual([
      20, 141, 78, 189, 40, 125, 312,
    ]);
  });

  it('measures distance as the gap in km from origin', () => {
    const distances = sections(STOPS).map((section) => section.distanceKm);
    for (const [index, expected] of [30, 233.6, 129.6, 260.4, 43.8, 225.4, 465.6].entries()) {
      expect(distances[index]).toBeCloseTo(expected, 1);
    }
  });

  it('adds up to the whole journey, so no distance is lost between sections', () => {
    const total = sections(STOPS).reduce((sum, section) => sum + section.distanceKm, 0);
    expect(total).toBeCloseTo(1388.4, 1);
  });

  it('adds up to the timetabled run time of 15 h 32 min of running and halts', () => {
    const running = sections(STOPS).reduce((sum, section) => sum + section.timetabledMin, 0);
    const halted = 1952 - 1020 - running;
    expect(running + halted).toBe(932);
  });

  it('carries the stop numbers each section runs between', () => {
    expect(sections(STOPS).map((section) => `${section.fromSeq}-${section.toSeq}`)).toEqual([
      '0-1',
      '1-2',
      '2-3',
      '3-4',
      '4-5',
      '5-6',
      '6-7',
    ]);
  });

  it('skips a pair it cannot measure, rather than inventing a run time', () => {
    const missing: TimetableStop[] = [
      {
        trainNumber: '12951',
        seq: 0,
        stationCode: 'BCT',
        km: 0,
        schedArrMin: null,
        schedDepMin: null,
      },
      {
        trainNumber: '12951',
        seq: 1,
        stationCode: 'BVI',
        km: 30,
        schedArrMin: 1040,
        schedDepMin: 1042,
      },
    ];
    expect(sections(missing)).toEqual([]);
  });

  it('returns nothing for a timetable with one stop', () => {
    expect(sections(STOPS.slice(0, 1))).toEqual([]);
  });
});

describe('sectionPace', () => {
  it('is below 1 when the train ran fast', () => {
    expect(sectionPace(150, 180)).toBeCloseTo(0.833, 3);
  });

  it('is exactly 1 when the train ran to the timetable', () => {
    expect(sectionPace(180, 180)).toBe(1);
  });

  it('is above 1 when the train ran slow', () => {
    expect(sectionPace(200, 180)).toBeCloseTo(1.111, 3);
  });

  it('refuses a section with no timetabled time, which would divide by zero', () => {
    expect(() => sectionPace(150, 0)).toThrow('a timetabled run time above zero');
  });

  it('refuses a negative run time', () => {
    expect(() => sectionPace(-5, 180)).toThrow('a run time of zero or more');
  });
});

describe('recentPace', () => {
  it('is the timetable when no section has finished', () => {
    expect(recentPace([])).toBe(1);
  });

  it('is that section alone when only one has finished', () => {
    expect(recentPace([0.83])).toBe(0.83);
  });

  it('weights the latest section 0.6 and the one before it 0.4', () => {
    expect(recentPace([0.9, 0.8])).toBeCloseTo(0.84, 10);
  });

  it('ignores everything before the last two sections', () => {
    expect(recentPace([0.2, 0.3, 0.9, 0.8])).toBeCloseTo(0.84, 10);
  });

  it('stays between the two paces it blends', () => {
    const blended = recentPace([0.9, 0.8]);
    expect(blended).toBeGreaterThanOrEqual(0.8);
    expect(blended).toBeLessThanOrEqual(0.9);
  });

  it('leans towards the latest section, because it is the better evidence', () => {
    expect(recentPace([1.2, 0.8])).toBeLessThan(recentPace([0.8, 1.2]));
  });
});

describe('sectionCap', () => {
  it('reproduces the 12951 cap table in ARCHITECTURE.md', () => {
    const caps = sections(STOPS).map((section) => sectionCap(section, TOP_SPEED_KMH));
    for (const [index, expected] of [0.88, 0.867, 0.867, 0.89, 0.912, 0.856, 0.881].entries()) {
      expect(caps[index]).toBeCloseTo(expected, 3);
    }
  });

  it('never allows a pace that would need more than the top speed', () => {
    const section = { fromSeq: 0, toSeq: 1, distanceKm: 400, timetabledMin: 190 };
    const minutesAtTopSpeed = (section.distanceKm / TOP_SPEED_KMH) * 60;
    expect(sectionCap(section, TOP_SPEED_KMH) * section.timetabledMin).toBeGreaterThanOrEqual(
      minutesAtTopSpeed,
    );
  });

  it('falls back to the spare time limit when the train has no recorded top speed', () => {
    const section = { fromSeq: 0, toSeq: 1, distanceKm: 30, timetabledMin: 20 };
    expect(sectionCap(section, null)).toBeCloseTo(0.88, 3);
  });

  it('takes a learned cap that is faster than the formula, because reality wins', () => {
    const section = { fromSeq: 0, toSeq: 1, distanceKm: 30, timetabledMin: 20 };
    expect(sectionCap(section, TOP_SPEED_KMH, 0.8)).toBe(0.8);
  });

  it('ignores a learned cap slower than the formula, so one slow trip cannot tighten it', () => {
    const section = { fromSeq: 0, toSeq: 1, distanceKm: 30, timetabledMin: 20 };
    expect(sectionCap(section, TOP_SPEED_KMH, 0.95)).toBeCloseTo(0.88, 3);
  });

  it('stays above zero on every 12951 section, since no cap may allow instant travel', () => {
    for (const cap of sections(STOPS).map((section) => sectionCap(section, TOP_SPEED_KMH))) {
      expect(cap).toBeGreaterThan(0);
      expect(cap).toBeLessThanOrEqual(1);
    }
  });
});

describe('capPace', () => {
  it('holds a pace faster than the cap back to the cap', () => {
    expect(capPace(0.5, 0.88)).toBe(0.88);
  });

  it('leaves a pace slower than the cap alone', () => {
    expect(capPace(0.95, 0.88)).toBe(0.95);
  });

  it('leaves a pace exactly at the cap alone', () => {
    expect(capPace(0.88, 0.88)).toBe(0.88);
  });

  it('never returns a pace faster than the cap, for any pace', () => {
    for (const pace of [0, 0.1, 0.5, 0.879, 0.88, 1, 1.5, 3]) {
      expect(capPace(pace, 0.88)).toBeGreaterThanOrEqual(0.88);
    }
  });

  it('catches a pace that is not a number instead of passing it on', () => {
    expect(() => capPace(Number.NaN, 0.88)).toThrow('a pace at or above the section cap');
  });
});
