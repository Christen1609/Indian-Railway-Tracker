import { describe, expect, it } from 'vitest';
import { learnCaps, observedPaces } from './estimate.js';
import type { SectionCapSeen } from './estimate.js';
import { timetableMinuteToUtc } from './time.js';
import type { EventType, ResolvedEvent, TimetableStop } from './types.js';

const JOURNEY_DATE = '2026-10-21';

const STOPS: TimetableStop[] = [
  { seq: 0, stationCode: 'BCT', km: 0, schedArrMin: null, schedDepMin: 1020 },
  { seq: 1, stationCode: 'BVI', km: 30, schedArrMin: 1040, schedDepMin: 1042 },
  { seq: 2, stationCode: 'ST', km: 263.6, schedArrMin: 1183, schedDepMin: 1188 },
].map((stop) => ({ ...stop, trainNumber: '12951' }));

/** One confirmed event at the given timetable minute */
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

describe('observedPaces', () => {
  it('records a section the train both left and reached', () => {
    const run = [at('BCT', 'DEP', 1020), at('BVI', 'ARR', 1040)];
    expect(observedPaces(STOPS, run, JOURNEY_DATE)).toEqual(new Map([[0, 1]]));
  });

  it('measures a section run fast as a pace below one', () => {
    const run = [at('BCT', 'DEP', 1020), at('BVI', 'ARR', 1035)];
    expect(observedPaces(STOPS, run, JOURNEY_DATE).get(0)).toBeCloseTo(15 / 20, 5);
  });

  it('ignores a section the train left but has not reached the end of', () => {
    const run = [at('BVI', 'DEP', 1042)];
    expect(observedPaces(STOPS, run, JOURNEY_DATE).has(1)).toBe(false);
  });

  it('ignores a station that is not on this timetable', () => {
    const run = [at('PUNE', 'DEP', 1020), at('BVI', 'ARR', 1040)];
    expect(observedPaces(STOPS, run, JOURNEY_DATE).size).toBe(0);
  });

  it('records every finished section of a whole run', () => {
    const run = [
      at('BCT', 'DEP', 1020),
      at('BVI', 'ARR', 1040),
      at('BVI', 'DEP', 1042),
      at('ST', 'ARR', 1183),
    ];
    expect([...observedPaces(STOPS, run, JOURNEY_DATE).keys()]).toEqual([0, 1]);
  });
});

describe('learnCaps', () => {
  const known: SectionCapSeen[] = [{ fromSeq: 0, fastestPace: 0.9, tripsSeen: 4 }];

  it('records a section nobody has run before, on its first trip', () => {
    expect(learnCaps([], new Map([[0, 0.95]]))).toEqual([
      { fromSeq: 0, fastestPace: 0.95, tripsSeen: 1 },
    ]);
  });

  it('lowers the cap when this journey beat the record', () => {
    expect(learnCaps(known, new Map([[0, 0.82]]))).toEqual([
      { fromSeq: 0, fastestPace: 0.82, tripsSeen: 5 },
    ]);
  });

  it('keeps the record when this journey was slower, and still counts the trip', () => {
    expect(learnCaps(known, new Map([[0, 1.3]]))).toEqual([
      { fromSeq: 0, fastestPace: 0.9, tripsSeen: 5 },
    ]);
  });

  it('writes nothing for a journey that finished no section', () => {
    expect(learnCaps(known, new Map())).toEqual([]);
  });

  it('leaves a section this journey did not run untouched', () => {
    expect(learnCaps(known, new Map([[1, 0.7]])).map((cap) => cap.fromSeq)).toEqual([1]);
  });
});
