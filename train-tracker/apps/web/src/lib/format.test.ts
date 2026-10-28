import { describe, expect, it } from 'vitest';
import type { TrainState } from '@train-tracker/core/types';
import {
  delayTone,
  describeTrainStatus,
  formatAgo,
  formatClock,
  formatDelay,
  formatJourneyClock,
  formatJourneyDate,
  formatKm,
  formatPace,
  formatTimetableMinute,
  formatWindow,
} from './format';

const JOURNEY_DATE = '2026-10-27';

describe('formatTimetableMinute', () => {
  it.each([
    ['day 1 shows only the clock', 1020, '17:00'],
    ['midnight of day 1 shows only the clock', 0, '00:00'],
    ['the last minute of day 1 shows only the clock', 1439, '23:59'],
    ['day 2 adds the day', 1952, '08:32 · day 2'],
    ['midnight of day 2 adds the day', 1440, '00:00 · day 2'],
    ['day 3 adds the day', 2900, '00:20 · day 3'],
  ])('%s', (_name, minute, expected) => {
    expect(formatTimetableMinute(minute)).toBe(expected);
  });
});

describe('formatJourneyClock', () => {
  it.each([
    ['UTC evening is IST night on day 1', '2026-10-27T11:30:00.000Z', '17:00'],
    ['after IST midnight is day 2', '2026-10-27T18:40:00.000Z', '00:10 · day 2'],
    ['the next morning is day 2', '2026-10-28T03:02:00.000Z', '08:32 · day 2'],
  ])('%s', (_name, at, expected) => {
    expect(formatJourneyClock(JOURNEY_DATE, at)).toBe(expected);
  });
});

describe('formatWindow', () => {
  it('shows the clock range inside one day', () => {
    const window = {
      windowStart: '2026-10-27T15:49:00.000Z',
      windowEnd: '2026-10-27T15:59:00.000Z',
    };
    expect(formatWindow(JOURNEY_DATE, window)).toBe('21:19–21:29');
  });

  it('adds the day once when the window crosses midnight', () => {
    const window = {
      windowStart: '2026-10-27T18:20:00.000Z',
      windowEnd: '2026-10-27T18:40:00.000Z',
    };
    expect(formatWindow(JOURNEY_DATE, window)).toBe('23:50–00:10 · day 2');
  });
});

describe('formatJourneyDate', () => {
  it('shows weekday, day, month and year', () => {
    expect(formatJourneyDate('2026-10-27')).toBe('Tue 27 Oct 2026');
  });
});

describe('formatClock', () => {
  it.each([
    ['IST afternoon', '2026-10-27T10:00:00.000Z', '15:30'],
    ['IST date ahead of the UTC date', '2026-10-27T19:00:00.000Z', '00:30'],
    ['IST midnight', '2026-10-27T18:30:00.000Z', '00:00'],
  ])('%s', (_name, at, expected) => {
    expect(formatClock(at)).toBe(expected);
  });
});

describe('formatAgo', () => {
  const now = '2026-10-28T12:00:00.000Z';
  it.each([
    ['under half a minute', '2026-10-28T11:59:40.000Z', 'just now'],
    ['an instant in the future', '2026-10-28T12:05:00.000Z', 'just now'],
    ['whole minutes', '2026-10-28T11:57:00.000Z', '3 min ago'],
    ['the last minute before an hour', '2026-10-28T11:01:00.000Z', '59 min ago'],
    ['whole hours', '2026-10-28T09:10:00.000Z', '2 h ago'],
    ['whole days', '2026-10-26T09:00:00.000Z', '2 d ago'],
  ])('%s', (_name, at, expected) => {
    expect(formatAgo(at, now)).toBe(expected);
  });
});

describe('formatDelay and delayTone', () => {
  it.each([
    [17, '17 min late', 'late'],
    [15, '15 min late', 'warn'],
    [1, '1 min late', 'warn'],
    [0, 'On time', 'ok'],
    [-1, 'On time', 'ok'],
    [-4, '4 min early', 'ok'],
  ])('%i min', (delayMin, text, tone) => {
    expect(formatDelay(delayMin)).toBe(text);
    expect(delayTone(delayMin)).toBe(tone);
  });
});

describe('formatPace', () => {
  it.each([
    [1, 'On the timetable'],
    [1.004, 'On the timetable'],
    [0.8796, '12% faster than the timetable'],
    [1.07, '7% slower than the timetable'],
  ])('%f', (pace, expected) => {
    expect(formatPace(pace)).toBe(expected);
  });
});

describe('formatKm', () => {
  it.each([
    [1384, '1,384 km'],
    [1383.6, '1,384 km'],
    [30, '30 km'],
    [123456, '1,23,456 km'],
  ])('%f', (distanceKm, expected) => {
    expect(formatKm(distanceKm)).toBe(expected);
  });
});

const STATE: TrainState = {
  journeyId: 'j1',
  state: 'running',
  km: 100,
  loKm: 95,
  hiKm: 105,
  pace: 1,
  delayMin: 17,
  nextStation: 'KOTA',
  window: null,
  nextCheckAt: null,
  updatedAt: '2026-10-27T10:00:00.000Z',
};
const PLACES = { originName: 'Mumbai Central', destinationName: 'New Delhi', departMin: 1020 };

describe('describeTrainStatus', () => {
  it.each([
    [
      'running late with the next stop',
      { ...STATE },
      'Kota Jn',
      { text: 'Running 17 min late, next stop Kota Jn', tone: 'late' },
    ],
    [
      'a small delay is a warning',
      { ...STATE, delayMin: 5 },
      null,
      { text: 'Running 5 min late', tone: 'warn' },
    ],
    [
      'on time with the next stop',
      { ...STATE, delayMin: 0 },
      'Surat',
      { text: 'On time, next stop Surat', tone: 'ok' },
    ],
    [
      'running early',
      { ...STATE, delayMin: -4 },
      null,
      { text: 'Running 4 min early', tone: 'ok' },
    ],
    [
      'running with no delay known',
      { ...STATE, delayMin: null },
      null,
      { text: 'Running', tone: 'ok' },
    ],
    [
      'halted and late',
      { ...STATE, state: 'halted' as const },
      null,
      { text: 'Halted 17 min late', tone: 'late' },
    ],
    [
      'arrived late',
      { ...STATE, state: 'arrived' as const, delayMin: 10 },
      null,
      { text: 'Arrived New Delhi, 10 min late', tone: 'warn' },
    ],
    [
      'arrived on time',
      { ...STATE, state: 'arrived' as const, delayMin: 0 },
      null,
      { text: 'Arrived New Delhi, on time', tone: 'ok' },
    ],
    [
      'not started with a departure time',
      { ...STATE, state: 'scheduled' as const },
      null,
      { text: 'Leaves Mumbai Central at 17:00', tone: 'idle' },
    ],
  ])('%s', (_name, state, nextName, expected) => {
    expect(describeTrainStatus({ state, nextName, ...PLACES })).toEqual(expected);
  });

  it('says leaving without a time when the timetable has none', () => {
    const status = describeTrainStatus({
      state: { ...STATE, state: 'scheduled' },
      nextName: null,
      ...PLACES,
      departMin: null,
    });
    expect(status.text).toBe('Leaves Mumbai Central');
  });

  it('says no position when there is no state', () => {
    expect(describeTrainStatus({ state: null, nextName: null, ...PLACES })).toEqual({
      text: 'No position recorded yet',
      tone: 'idle',
    });
  });
});
