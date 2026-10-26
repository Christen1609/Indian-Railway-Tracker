import { describe, expect, it } from 'vitest';
import { estimate, expectedDepartureMin, sections } from '../estimate.js';
import { timetableMinuteToUtc, utcToTimetableMinute } from '../time.js';
import type { Estimate, EventType, ResolvedEvent, TimetableStop } from '../types.js';
import { nextCheck } from './next-check.js';
import type { NextCheckInput } from './next-check.js';

const JOURNEY_DATE = '2026-10-21';
const TOP_SPEED_KMH = 130;
const PACE_RAN = 1.05;
const TRIP_BUDGET_CALLS = 25;

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

const utc = (minute: number): string => timetableMinuteToUtc(JOURNEY_DATE, minute);
const minuteOf = (when: string): number => utcToTimetableMinute(JOURNEY_DATE, when);

/** One resolved event at the given timetable minute */
function at(stationCode: string, type: EventType, minute: number): ResolvedEvent {
  const when = utc(minute);
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

/** A running estimate with the given arrival window, with any part of it replaced */
function running(startMin: number, endMin: number, over: Partial<Estimate> = {}): Estimate {
  return {
    state: 'running',
    km: 300,
    loKm: 290,
    hiKm: 310,
    pace: 1.07,
    delayMin: 0,
    nextStation: 'BRC',
    window: { windowStart: utc(startMin), windowEnd: utc(endMin) },
    ...over,
  };
}

/** A watched journey that has left origin, with any part of it replaced */
function input(nowMin: number, over: Partial<NextCheckInput> = {}): NextCheckInput {
  return {
    journeyDate: JOURNEY_DATE,
    stops: STOPS,
    confirmed: [at('ST', 'DEP', 1201)],
    estimate: running(1279, 1289),
    watchingSince: utc(1000),
    isScored: false,
    lastCheckedAt: utc(1201),
    now: utc(nowMin),
    ...over,
  };
}

/** The minute a check is due, or null when none is */
function dueMin(over: Partial<NextCheckInput>, nowMin: number): number | null {
  const due = nextCheck(input(nowMin, over)); // the next check, from nextCheck
  return due.at === null ? null : minuteOf(due.at);
}

describe('nextCheck, against the worked example in DATA_SOURCES.md', () => {
  const open = { estimate: running(1279, 1289) };
  const late = { estimate: running(1279, 1289, { state: 'late' }) };

  it('opens the ladder at the window start, 21:19', () => {
    expect(dueMin({ ...open, lastCheckedAt: utc(1201) }, 1210)).toBe(1279);
  });

  it('climbs the window every 5 min to its close: 21:24 then 21:29', () => {
    expect(dueMin({ ...open, lastCheckedAt: utc(1279) }, 1279)).toBe(1284);
    expect(dueMin({ ...open, lastCheckedAt: utc(1284) }, 1284)).toBe(1289);
  });

  it('moves to the late ladder once the window is spent: 21:34, 21:39, 21:49', () => {
    expect(dueMin({ ...late, lastCheckedAt: utc(1289) }, 1289)).toBe(1294);
    expect(dueMin({ ...late, lastCheckedAt: utc(1294) }, 1294)).toBe(1299);
    expect(dueMin({ ...late, lastCheckedAt: utc(1299) }, 1299)).toBe(1309);
  });

  it('keeps the late ladder going at 10 then 15 min, never faster', () => {
    expect(dueMin({ ...late, lastCheckedAt: utc(1309) }, 1309)).toBe(1319);
    expect(dueMin({ ...late, lastCheckedAt: utc(1319) }, 1319)).toBe(1334);
    expect(dueMin({ ...late, lastCheckedAt: utc(1334) }, 1334)).toBe(1349);
    expect(dueMin({ ...late, lastCheckedAt: utc(1500) }, 1500)).toBe(1514);
  });
});

describe('nextCheck, what stops a check happening', () => {
  it('checks nothing when nobody is watching', () => {
    expect(nextCheck(input(1210, { watchingSince: null }))).toEqual({
      at: null,
      reason: 'not_watched',
    });
  });

  it('checks the scored journey even with nobody watching', () => {
    expect(nextCheck(input(1210, { watchingSince: null, isScored: true })).reason).toBe(
      'window_open',
    );
  });

  it('stops for good once the train has arrived', () => {
    const arrived = running(1279, 1289, { state: 'arrived', window: null });
    expect(nextCheck(input(1210, { estimate: arrived }))).toEqual({
      at: null,
      reason: 'arrived',
    });
  });

  it('waits for the window instead of checking mid-section', () => {
    expect(dueMin({ lastCheckedAt: utc(1201) }, 1240)).toBe(1279);
  });

  it('waits for the next window instead of checking a halt', () => {
    const halted = running(1300, 1310, { state: 'halted' });
    expect(dueMin({ estimate: halted, lastCheckedAt: utc(1279) }, 1280)).toBe(1300);
  });
});

describe('nextCheck, the catch-up check', () => {
  it('checks at once when a watcher opens a journey never checked before', () => {
    expect(nextCheck(input(1210, { watchingSince: utc(1210), lastCheckedAt: null }))).toEqual({
      at: utc(1210),
      reason: 'catch_up',
    });
  });

  it('skips the catch-up when the state is already fresh', () => {
    const due = nextCheck(input(1210, { watchingSince: utc(1210), lastCheckedAt: utc(1208) }));
    expect(due.reason).not.toBe('catch_up');
  });

  it('catches up once per watching session, not every 5 min', () => {
    const session = utc(1210);
    expect(nextCheck(input(1210, { watchingSince: session, lastCheckedAt: null })).reason).toBe(
      'catch_up',
    );
    const later = nextCheck(input(1240, { watchingSince: session, lastCheckedAt: utc(1210) }));
    expect(later.reason).not.toBe('catch_up');
  });

  it('catches up again when the journey is reopened after everyone left', () => {
    expect(nextCheck(input(1400, { watchingSince: utc(1400), lastCheckedAt: utc(1210) }))).toEqual({
      at: utc(1400),
      reason: 'catch_up',
    });
  });
});

describe('nextCheck, confirming the origin departure', () => {
  const beforeStart = { confirmed: [], estimate: running(1040, 1045, { state: 'scheduled' }) };

  it('holds off until 2 min after the timetabled departure', () => {
    expect(dueMin({ ...beforeStart, lastCheckedAt: utc(1000) }, 1005)).toBe(1022);
  });

  it('then asks every 5 min until the departure is confirmed', () => {
    expect(dueMin({ ...beforeStart, lastCheckedAt: utc(1022) }, 1022)).toBe(1027);
    expect(dueMin({ ...beforeStart, lastCheckedAt: utc(1027) }, 1027)).toBe(1032);
  });

  it('stops asking about departure once it is confirmed', () => {
    const due = nextCheck(
      input(1030, {
        confirmed: [at('BCT', 'DEP', 1020)],
        estimate: running(1040, 1045),
        lastCheckedAt: utc(1027),
      }),
    );
    expect(due.reason).toBe('window_open');
  });
});

/** Every event the source would report, for a journey run at a steady pace */
function journeyTruth(paceRan: number): ResolvedEvent[] {
  const origin = STOPS[0];
  const originDepMin = origin?.schedDepMin ?? 0;
  const events = [at(origin?.stationCode ?? '', 'DEP', originDepMin)];
  let departedMin = originDepMin;
  for (const section of sections(STOPS)) {
    // one section per measurable pair, from sections
    const to = STOPS.find((stop) => stop.seq === section.toSeq);
    if (to === undefined) {
      continue;
    }
    const arrivedMin = Math.round(departedMin + section.timetabledMin * paceRan);
    events.push(at(to.stationCode, 'ARR', arrivedMin));
    if (to.schedDepMin !== null) {
      departedMin = expectedDepartureMin(arrivedMin, to); // earliest departure, from expectedDepartureMin
      events.push(at(to.stationCode, 'DEP', departedMin));
    }
  }
  return events;
}

/** Calls spent on one whole journey, with a fake clock and a fake source */
function wholeJourney(): { calls: number; reasons: string[] } {
  const truth = journeyTruth(PACE_RAN); // every event the source would report, from journeyTruth
  const watchingSince = utc(1010);
  const reasons: string[] = [];
  let lastCheckedMin: number | null = null;

  for (let nowMin = 1010; nowMin <= 2100; nowMin += 1) {
    const checkedAt = lastCheckedMin;
    const confirmed =
      checkedAt === null ? [] : truth.filter((event) => minuteOf(event.at) <= checkedAt);
    const now = utc(nowMin);
    // where the train is, from estimate
    const where = estimate({
      journeyDate: JOURNEY_DATE,
      stops: STOPS,
      confirmed,
      topSpeedKmh: TOP_SPEED_KMH,
      now,
    });
    // the next check, from nextCheck
    const due = nextCheck({
      journeyDate: JOURNEY_DATE,
      stops: STOPS,
      confirmed,
      estimate: where,
      watchingSince,
      isScored: false,
      lastCheckedAt: checkedAt === null ? null : utc(checkedAt),
      now,
    });
    if (due.at === null) {
      break;
    }
    if (minuteOf(due.at) <= nowMin) {
      reasons.push(due.reason);
      lastCheckedMin = nowMin;
    }
  }
  return { calls: reasons.length, reasons };
}

describe('nextCheck, the cost of a whole journey', () => {
  it('spends 22 calls on a full 12951 run, inside the budget of 25', () => {
    const spent = wholeJourney(); // calls and why, from wholeJourney
    expect(spent.calls).toBe(22);
    expect(spent.calls).toBeLessThanOrEqual(TRIP_BUDGET_CALLS);
  });

  it('spends them on catching up, departure and open windows, never on a timer', () => {
    const spent = wholeJourney(); // calls and why, from wholeJourney
    expect(new Set(spent.reasons)).toEqual(new Set(['catch_up', 'departure', 'window_open']));
  });
});
