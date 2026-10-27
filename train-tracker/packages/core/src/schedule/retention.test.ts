import { describe, expect, it } from 'vitest';
import { plusMinutes, timetableMinuteToUtc } from '../time.js';
import type { EventType, ResolvedEvent, TimetableStop } from '../types.js';
import { retentionCheck } from './retention.js';
import type { RetentionInput } from './retention.js';

const JOURNEY_DATE = '2026-10-21';
const RETENTION_HOURS = 24;
const NDLS_ARR_MIN = 1952;
const MIN_PER_HOUR = 60;

const STOPS: TimetableStop[] = [
  { seq: 0, stationCode: 'BCT', km: 0, schedArrMin: null, schedDepMin: 1020 },
  { seq: 1, stationCode: 'KOTA', km: 922.8, schedArrMin: 1635, schedDepMin: 1640 },
  { seq: 2, stationCode: 'NDLS', km: 1388.4, schedArrMin: NDLS_ARR_MIN, schedDepMin: null },
].map((stop) => ({ ...stop, trainNumber: '12951' }));

const utc = (minute: number): string => timetableMinuteToUtc(JOURNEY_DATE, minute);

/** One confirmed event at the given timetable minute */
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

/** A 12951 journey being considered for deletion, with any part replaced */
function input(over: Partial<RetentionInput> = {}): RetentionInput {
  return {
    journeyDate: JOURNEY_DATE,
    stops: STOPS,
    confirmed: [],
    hasScores: false,
    retentionHours: RETENTION_HOURS,
    now: utc(NDLS_ARR_MIN),
    ...over,
  };
}

describe('retentionCheck, deciding a journey has ended', () => {
  it('leaves a running journey alone', () => {
    const verdict = retentionCheck(input({ now: utc(1700) }));
    expect(verdict).toMatchObject({ reason: 'running', endedAt: null, deleteRaw: false });
  });

  it('ends a journey on the confirmed arrival at its last stop', () => {
    const arrived = at('NDLS', 'ARR', 1997);
    const verdict = retentionCheck(input({ confirmed: [arrived], now: utc(1998) }));
    expect(verdict.endedAt).toBe(arrived.at);
    expect(verdict.reason).toBe('cooling');
  });

  it('ends a journey 2 h after its timetabled arrival when none was confirmed', () => {
    const lapses = NDLS_ARR_MIN + 2 * MIN_PER_HOUR;
    expect(retentionCheck(input({ now: utc(lapses - 1) })).reason).toBe('running');
    expect(retentionCheck(input({ now: utc(lapses) })).endedAt).toBe(utc(lapses));
  });

  it('does not end on an arrival at a stop that is not the last one', () => {
    const verdict = retentionCheck(input({ confirmed: [at('KOTA', 'ARR', 1664)], now: utc(1700) }));
    expect(verdict.reason).toBe('running');
  });
});

describe('retentionCheck, the cooling window', () => {
  const arrived = at('NDLS', 'ARR', 1997);
  const ended = { confirmed: [arrived] };

  it('keeps everything for the retention hours after it ended', () => {
    const verdict = retentionCheck(
      input({ ...ended, now: plusMinutes(arrived.at, RETENTION_HOURS * MIN_PER_HOUR - 1) }),
    );
    expect(verdict).toMatchObject({ reason: 'cooling', deleteRaw: false, deleteDerived: false });
  });

  it('lets the raw responses go once the window has passed', () => {
    const verdict = retentionCheck(
      input({ ...ended, now: plusMinutes(arrived.at, RETENTION_HOURS * MIN_PER_HOUR) }),
    );
    expect(verdict).toMatchObject({ reason: 'raw_only', deleteRaw: true, deleteDerived: false });
  });

  it('honours a shorter retention setting', () => {
    const verdict = retentionCheck(
      input({ ...ended, retentionHours: 1, now: plusMinutes(arrived.at, MIN_PER_HOUR) }),
    );
    expect(verdict.deleteRaw).toBe(true);
  });
});

describe('retentionCheck, what scoring protects', () => {
  const arrived = at('NDLS', 'ARR', 1997);
  const due = {
    confirmed: [arrived],
    now: plusMinutes(arrived.at, RETENTION_HOURS * MIN_PER_HOUR),
  };

  it('holds the confirmed events back until the journey has been scored', () => {
    const verdict = retentionCheck(input({ ...due, hasScores: false }));
    expect(verdict).toMatchObject({ reason: 'raw_only', deleteRaw: true, deleteDerived: false });
  });

  it('lets everything go once the scores are written', () => {
    const verdict = retentionCheck(input({ ...due, hasScores: true }));
    expect(verdict).toMatchObject({ reason: 'everything', deleteRaw: true, deleteDerived: true });
  });

  it('never deletes the derived data without also having let the raw go', () => {
    for (const hasScores of [false, true]) {
      const verdict = retentionCheck(input({ ...due, hasScores }));
      expect(verdict.deleteDerived && !verdict.deleteRaw).toBe(false);
    }
  });
});
