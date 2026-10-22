import { describe, expect, it } from 'vitest';
import {
  dayOffset,
  formatIstClock,
  istDateOf,
  timetableMinuteToUtc,
  toUtc,
  utcToTimetableMinute,
} from './time.js';

const JOURNEY_DATE = '2026-10-21';

describe('toUtc', () => {
  it('converts an IST timestamp to UTC', () => {
    expect(toUtc('2026-10-21T17:00:00+05:30')).toBe('2026-10-21T11:30:00.000Z');
  });

  it('keeps a timestamp that is already UTC', () => {
    expect(toUtc('2026-10-21T11:30:00Z')).toBe('2026-10-21T11:30:00.000Z');
  });

  it('crosses midnight IST into the previous UTC day', () => {
    expect(toUtc('2026-10-22T00:25:00+05:30')).toBe('2026-10-21T18:55:00.000Z');
  });

  it('keeps fractional seconds out of the result', () => {
    expect(toUtc('2026-10-21T17:00:00.250+05:30')).toBe('2026-10-21T11:30:00.250Z');
  });

  it('rejects a timestamp with no offset, because the zone would be a guess', () => {
    expect(toUtc('2026-10-21T17:00:00')).toBeNull();
  });

  it('rejects a date with no time', () => {
    expect(toUtc('2026-10-21')).toBeNull();
  });

  it('rejects an impossible date rather than rolling it into the next month', () => {
    expect(toUtc('2026-02-30T10:00:00+05:30')).toBeNull();
    expect(toUtc('2026-13-01T10:00:00+05:30')).toBeNull();
    expect(toUtc('2025-02-29T10:00:00+05:30')).toBeNull();
  });

  it('accepts a real leap day', () => {
    expect(toUtc('2028-02-29T10:00:00+05:30')).toBe('2028-02-29T04:30:00.000Z');
  });

  it('rejects an impossible time', () => {
    expect(toUtc('2026-10-21T25:00:00+05:30')).toBeNull();
    expect(toUtc('2026-10-21T10:61:00+05:30')).toBeNull();
  });

  it('rejects rubbish', () => {
    expect(toUtc('')).toBeNull();
    expect(toUtc('not a time')).toBeNull();
  });
});

describe('istDateOf', () => {
  it('reads the IST date of a UTC instant', () => {
    expect(istDateOf('2026-10-21T11:30:00.000Z')).toBe('2026-10-21');
  });

  it('gives the next IST date for a late evening UTC instant', () => {
    expect(istDateOf('2026-10-21T18:55:00.000Z')).toBe('2026-10-22');
  });

  it('gives the previous IST date just before 18:30 UTC', () => {
    expect(istDateOf('2026-10-21T18:29:59.000Z')).toBe('2026-10-21');
  });

  it('rolls over exactly at 18:30 UTC, which is midnight IST', () => {
    expect(istDateOf('2026-10-21T18:30:00.000Z')).toBe('2026-10-22');
  });
});

describe('timetableMinuteToUtc', () => {
  it('refuses a journey date that does not exist', () => {
    expect(() => timetableMinuteToUtc('2026-02-30', 1020)).toThrow('a real journey date');
    expect(() => timetableMinuteToUtc('21-10-2026', 1020)).toThrow('a real journey date');
  });

  it('converts the 12951 origin departure', () => {
    expect(timetableMinuteToUtc(JOURNEY_DATE, 1020)).toBe('2026-10-21T11:30:00.000Z');
  });

  it('converts a day 2 arrival, so 1952 is 08:32 the next morning', () => {
    expect(timetableMinuteToUtc(JOURNEY_DATE, 1952)).toBe('2026-10-22T03:02:00.000Z');
  });

  it('converts midnight IST on day 1', () => {
    expect(timetableMinuteToUtc(JOURNEY_DATE, 0)).toBe('2026-10-20T18:30:00.000Z');
  });
});

describe('utcToTimetableMinute', () => {
  it('inverts timetableMinuteToUtc', () => {
    for (const min of [0, 1020, 1465, 1952]) {
      const at = timetableMinuteToUtc(JOURNEY_DATE, min); // UTC instant, from timetableMinuteToUtc
      expect(utcToTimetableMinute(JOURNEY_DATE, at)).toBe(min);
    }
  });

  it('counts past 1440 for a time on day 2', () => {
    expect(utcToTimetableMinute(JOURNEY_DATE, '2026-10-22T03:02:00.000Z')).toBe(1952);
  });

  it('goes negative for an instant before midnight IST on day 1', () => {
    expect(utcToTimetableMinute(JOURNEY_DATE, '2026-10-20T18:29:00.000Z')).toBe(-1);
  });

  it('rounds to the nearest whole minute, so a confirmed time keeps its minute', () => {
    expect(utcToTimetableMinute(JOURNEY_DATE, '2026-10-22T03:02:29.000Z')).toBe(1952);
    expect(utcToTimetableMinute(JOURNEY_DATE, '2026-10-22T03:02:31.000Z')).toBe(1953);
  });
});

describe('dayOffset', () => {
  it('calls the origin day 1', () => {
    expect(dayOffset(0)).toBe(1);
    expect(dayOffset(1020)).toBe(1);
    expect(dayOffset(1439)).toBe(1);
  });

  it('calls the first minute past midnight day 2', () => {
    expect(dayOffset(1440)).toBe(2);
    expect(dayOffset(1952)).toBe(2);
  });

  it('reaches day 3 on a long journey', () => {
    expect(dayOffset(2880)).toBe(3);
  });
});

describe('formatIstClock', () => {
  it('formats a day 1 time', () => {
    expect(formatIstClock(1020)).toBe('17:00');
  });

  it('drops the day when formatting a day 2 time', () => {
    expect(formatIstClock(1952)).toBe('08:32');
  });

  it('pads single digits', () => {
    expect(formatIstClock(1465)).toBe('00:25');
    expect(formatIstClock(0)).toBe('00:00');
  });

  it('formats every 12951 timetable minute', () => {
    expect([1020, 1040, 1042, 1183, 1188, 1266, 1276, 1952].map(formatIstClock)).toEqual([
      '17:00',
      '17:20',
      '17:22',
      '19:43',
      '19:48',
      '21:06',
      '21:16',
      '08:32',
    ]);
  });
});
