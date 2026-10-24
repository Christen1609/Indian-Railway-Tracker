import { describe, expect, it } from 'vitest';
import { arrivalWindow, estimate, expectedDepartureMin, sectionCap, sections } from './estimate.js';
import type { EstimateInput } from './estimate.js';
import { timetableMinuteToUtc, utcToTimetableMinute } from './time.js';
import type { EventType, ResolvedEvent, TimetableStop } from './types.js';

const JOURNEY_DATE = '2026-10-21';
const TOP_SPEED_KMH = 130;

const STOPS: TimetableStop[] = [
  { seq: 0, stationCode: 'BCT', km: 0, schedArrMin: null, schedDepMin: 1020 },
  { seq: 1, stationCode: 'BVI', km: 30, schedArrMin: 1040, schedDepMin: 1042 },
  { seq: 2, stationCode: 'ST', km: 263.6, schedArrMin: 1183, schedDepMin: 1188 },
  { seq: 3, stationCode: 'BRC', km: 393.2, schedArrMin: 1266, schedDepMin: 1276 },
  { seq: 4, stationCode: 'RTM', km: 653.6, schedArrMin: 1465, schedDepMin: 1468 },
  { seq: 5, stationCode: 'NAD', km: 697.4, schedArrMin: 1508, schedDepMin: 1510 },
  { seq: 6, stationCode: 'KOTA', km: 922.8, schedArrMin: 1635, schedDepMin: 1640 },
  { seq: 7, stationCode: 'NDLS', km: 1388.4, schedArrMin: 1952, schedDepMin: null },
].map((stop) => ({ ...stop, trainNumber: '12951' }));

/** One resolved event at the given timetable minute */
function at(stationCode: string, type: EventType, minute: number): ResolvedEvent {
  const when = timetableMinuteToUtc(JOURNEY_DATE, minute); // UTC instant, from timetableMinuteToUtc
  return {
    journeyId: 'j1',
    stationCode,
    type,
    at: when,
    confidenceScore: 1,
    confidence: 'high',
    chosenSource: 'railradar',
    sources: ['railradar'],
    resolvedAt: when,
  };
}

/** The 12951 journey at a given minute, with any part of it replaced */
function input(nowMin: number, over: Partial<EstimateInput> = {}): EstimateInput {
  return {
    journeyDate: JOURNEY_DATE,
    stops: STOPS,
    confirmed: [],
    topSpeedKmh: TOP_SPEED_KMH,
    now: timetableMinuteToUtc(JOURNEY_DATE, nowMin),
    ...over,
  };
}

describe('arrivalWindow, against the worked examples in ARCHITECTURE.md', () => {
  it('gives 156 to 189 minutes on a 180 min, 300 km section at pace 0.83', () => {
    const section = { fromSeq: 0, toSeq: 1, distanceKm: 300, timetabledMin: 180 };
    const cap = sectionCap(section, TOP_SPEED_KMH); // fastest allowed pace, from sectionCap
    expect(cap).toBeCloseTo(0.867, 3);
    const window = arrivalWindow(0, section, 150 / 180, cap);
    expect(window.startMin).toBe(156);
    expect(window.endMin).toBe(189);
  });

  it('gives 21:19 to 21:29 for Vadodara, left Surat at 20:01 at pace 1.07', () => {
    const stBrc = sections(STOPS)[2];
    expect(stBrc?.timetabledMin).toBe(78);
    const cap = sectionCap(
      stBrc ?? { fromSeq: 0, toSeq: 0, distanceKm: 0, timetabledMin: 1 },
      TOP_SPEED_KMH,
    );
    const window = arrivalWindow(
      1201,
      stBrc ?? { fromSeq: 0, toSeq: 0, distanceKm: 0, timetabledMin: 1 },
      1.07,
      cap,
    );
    expect(window.startMin).toBe(1279);
    expect(window.endMin).toBe(1289);
  });

  it('uses a 5 minute buffer on a short section and 5 per cent on a long one', () => {
    const short = { fromSeq: 0, toSeq: 1, distanceKm: 30, timetabledMin: 20 };
    const long = { fromSeq: 0, toSeq: 1, distanceKm: 465.6, timetabledMin: 312 };
    expect(arrivalWindow(0, short, 1, sectionCap(short, TOP_SPEED_KMH)).endMin).toBe(25);
    expect(arrivalWindow(0, long, 1, sectionCap(long, TOP_SPEED_KMH)).endMin).toBe(328);
  });

  it('never opens the window before the cap allows, however fast the train has been', () => {
    const section = { fromSeq: 0, toSeq: 1, distanceKm: 300, timetabledMin: 180 };
    const cap = sectionCap(section, TOP_SPEED_KMH);
    expect(arrivalWindow(0, section, 0.1, cap).startMin).toBe(Math.round(180 * cap));
  });

  it('never closes the window before the timetable, however early the train is', () => {
    const section = { fromSeq: 0, toSeq: 1, distanceKm: 300, timetabledMin: 180 };
    expect(arrivalWindow(0, section, 0.1, sectionCap(section, TOP_SPEED_KMH)).endMin).toBe(189);
  });

  it('keeps start at or before end for any pace', () => {
    const section = { fromSeq: 0, toSeq: 1, distanceKm: 300, timetabledMin: 180 };
    const cap = sectionCap(section, TOP_SPEED_KMH);
    for (const pace of [0.1, 0.5, 0.867, 0.95, 1, 1.5, 3]) {
      const window = arrivalWindow(1000, section, pace, cap);
      expect(window.startMin).toBeLessThanOrEqual(window.endMin);
    }
  });
});

describe('expectedDepartureMin', () => {
  it('is the timetabled departure when the train arrived early', () => {
    expect(expectedDepartureMin(1180, STOPS[2])).toBe(1188);
  });

  it('is arrival plus the timetabled halt when the train arrived late', () => {
    expect(expectedDepartureMin(1200, STOPS[2])).toBe(1205);
  });

  it('never leaves before the timetable, even arriving exactly on time', () => {
    expect(expectedDepartureMin(1183, STOPS[2])).toBe(1188);
  });
});

describe('estimate before the train leaves', () => {
  const result = estimate(input(1000)); // the journey at 16:40, from estimate

  it('is scheduled', () => {
    expect(result.state).toBe('scheduled');
  });

  it('sits at the origin with no zone', () => {
    expect(result.km).toBe(0);
    expect(result.loKm).toBe(0);
    expect(result.hiKm).toBe(0);
  });

  it('has no delay yet, because nothing has been confirmed', () => {
    expect(result.delayMin).toBeNull();
  });

  it('names the first stop it has to reach', () => {
    expect(result.nextStation).toBe('BVI');
  });

  it('runs at the timetable, having no finished section to learn from', () => {
    expect(result.pace).toBe(1);
  });
});

describe('estimate while running between stations', () => {
  const confirmed = [at('BCT', 'DEP', 1020), at('BVI', 'ARR', 1040), at('BVI', 'DEP', 1042)];
  const result = estimate(input(1100, { confirmed })); // 18:20, an hour into BVI to ST

  it('is running', () => {
    expect(result.state).toBe('running');
  });

  it('puts the train between the two stations', () => {
    expect(result.km).toBeGreaterThan(30);
    expect(result.km).toBeLessThan(263.6);
  });

  it('keeps the best guess inside the shaded zone', () => {
    expect(result.loKm).toBeLessThanOrEqual(result.km);
    expect(result.km).toBeLessThanOrEqual(result.hiKm);
  });

  it('shades no width at all while the train runs exactly to the timetable', () => {
    expect(result.pace).toBe(1);
    expect(result.hiKm).toBe(result.loKm);
  });

  it('names the station it is heading for', () => {
    expect(result.nextStation).toBe('ST');
  });

  it('opens a window for that station', () => {
    expect(result.window).not.toBeNull();
  });

  it('computes delay from the confirmed arrival minus the timetable, never copied', () => {
    expect(result.delayMin).toBe(0);
  });
});

describe('estimate when the train is late off the mark', () => {
  const confirmed = [at('BCT', 'DEP', 1020), at('BVI', 'ARR', 1056), at('BVI', 'DEP', 1057)];
  const result = estimate(input(1100, { confirmed }));

  it('reports the 16 minutes it lost reaching Borivali', () => {
    expect(result.delayMin).toBe(16);
  });

  it('is running slow, so its pace is above 1', () => {
    expect(result.pace).toBeGreaterThan(1);
  });
});

describe('estimate while halted at a station', () => {
  const confirmed = [at('BCT', 'DEP', 1020), at('BVI', 'ARR', 1040)];
  const result = estimate(input(1041, { confirmed }));

  it('is halted', () => {
    expect(result.state).toBe('halted');
  });

  it('stands exactly at the station, with no zone', () => {
    expect(result.km).toBe(30);
    expect(result.loKm).toBe(30);
    expect(result.hiKm).toBe(30);
  });
});

describe('estimate once the train has arrived', () => {
  const confirmed = [at('BCT', 'DEP', 1020), at('NDLS', 'ARR', 1948)];
  const result = estimate(input(1960, { confirmed }));

  it('is arrived', () => {
    expect(result.state).toBe('arrived');
  });

  it('sits at the destination', () => {
    expect(result.km).toBe(1388.4);
  });

  it('has no next station and no window', () => {
    expect(result.nextStation).toBeNull();
    expect(result.window).toBeNull();
  });

  it('reports arriving 4 minutes early as a negative delay', () => {
    expect(result.delayMin).toBe(-4);
  });
});

describe('estimate when the window has passed with no arrival', () => {
  const confirmed = [at('BCT', 'DEP', 1020), at('BVI', 'ARR', 1040), at('BVI', 'DEP', 1042)];
  const result = estimate(input(1300, { confirmed })); // long past the Surat window

  it('is late', () => {
    expect(result.state).toBe('late');
  });

  it('reports a delay of at least now minus the timetabled arrival', () => {
    expect(result.delayMin).toBeGreaterThanOrEqual(1300 - 1183);
  });

  it('holds short of the station it has not been confirmed to reach', () => {
    expect(result.km).toBeLessThan(263.6);
  });

  it('holds at 98 per cent of the section', () => {
    expect(result.km).toBeCloseTo(30 + 0.98 * 233.6, 1);
  });
});

describe('estimate invariants hold at every minute of the journey', () => {
  const confirmed = [at('BCT', 'DEP', 1020), at('BVI', 'ARR', 1040), at('BVI', 'DEP', 1042)];

  it('keeps loKm <= km <= hiKm throughout', () => {
    for (let minute = 1000; minute <= 1960; minute += 7) {
      const result = estimate(input(minute, { confirmed }));
      expect(result.loKm).toBeLessThanOrEqual(result.km);
      expect(result.km).toBeLessThanOrEqual(result.hiKm);
    }
  });

  it('keeps windowStart <= windowEnd throughout', () => {
    for (let minute = 1000; minute <= 1960; minute += 7) {
      const { window } = estimate(input(minute, { confirmed }));
      if (window !== null) {
        expect(window.windowStart <= window.windowEnd).toBe(true);
      }
    }
  });

  it('never puts the train past a station it has not been confirmed to reach', () => {
    for (let minute = 1000; minute <= 1960; minute += 7) {
      expect(estimate(input(minute, { confirmed })).hiKm).toBeLessThan(263.6);
    }
  });

  it('never moves the train backwards as time goes on', () => {
    let previous = -1;
    for (let minute = 1000; minute <= 1960; minute += 7) {
      const { km } = estimate(input(minute, { confirmed }));
      expect(km).toBeGreaterThanOrEqual(previous);
      previous = km;
    }
  });

  it('stays on the route from origin to destination', () => {
    for (let minute = 1000; minute <= 1960; minute += 7) {
      const result = estimate(input(minute, { confirmed }));
      expect(result.loKm).toBeGreaterThanOrEqual(0);
      expect(result.hiKm).toBeLessThanOrEqual(1388.4);
    }
  });
});

describe('estimate when the train is running ahead', () => {
  const confirmed = [at('BCT', 'DEP', 1020), at('BVI', 'ARR', 1032), at('BVI', 'DEP', 1033)];
  const result = estimate(input(1100, { confirmed }));

  it('is running fast, so its pace is below 1', () => {
    expect(result.pace).toBeCloseTo(0.6, 10);
  });

  it('shades a zone with real width, because fast and slow now disagree', () => {
    expect(result.hiKm).toBeGreaterThan(result.loKm);
  });

  it('keeps the best guess inside that zone', () => {
    expect(result.loKm).toBeLessThanOrEqual(result.km);
    expect(result.km).toBeLessThanOrEqual(result.hiKm);
  });

  it('reports arriving 8 minutes early as a negative delay', () => {
    expect(result.delayMin).toBe(-8);
  });

  it('lets a learned cap open the window earlier than the formula would', () => {
    const opensAt = (learnedCaps?: ReadonlyMap<number, number>): number => {
      const { window } = estimate(
        input(1100, { confirmed, ...(learnedCaps ? { learnedCaps } : {}) }),
      );
      expect(window).not.toBeNull();
      return utcToTimetableMinute(JOURNEY_DATE, window?.windowStart ?? '');
    };
    expect(opensAt(new Map([[1, 0.7]]))).toBeLessThan(opensAt());
  });
});
