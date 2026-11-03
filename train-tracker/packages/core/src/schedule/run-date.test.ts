import { describe, expect, it } from 'vitest';
import { STOPS_12951 as STOPS } from '../testing/journey-12951.js';
import { timetableMinuteToUtc } from '../time.js';
import type { JourneyStatus } from '../types.js';
import { LATE_RUN_GRACE_HOURS, currentRunDate } from './run-date.js';

const YESTERDAY = '2026-10-29';
const TODAY = '2026-10-30';
const NDLS_ARR_MIN = 1952;

/** A moment on 30 Oct IST, as hours and minutes after midnight */
const todayAt = (hours: number, minutes = 0): string =>
  timetableMinuteToUtc(TODAY, hours * 60 + minutes);

/** The run date at a moment on 30 Oct IST, given how yesterday's run stands */
function runDate(hours: number, minutes: number, yesterday: JourneyStatus | null): string {
  return currentRunDate({ stops: STOPS, now: todayAt(hours, minutes), yesterday });
}

describe('currentRunDate, yesterday run still on the line', () => {
  it('is the run that left yesterday at 04:00, while it is running', () => {
    expect(runDate(4, 0, 'running')).toBe(YESTERDAY);
  });

  it('is still that run when it is 3 hours late at 11:30, past its 08:32 schedule', () => {
    expect(runDate(11, 30, 'running')).toBe(YESTERDAY);
  });

  it('counts a run we never saw as still on the line, so a worker started mid-run follows it', () => {
    expect(runDate(4, 0, null)).toBe(YESTERDAY);
  });

  it('counts a run not yet marked running the same way', () => {
    expect(runDate(4, 0, 'scheduled')).toBe(YESTERDAY);
  });
});

describe('currentRunDate, yesterday run over', () => {
  it('is today once yesterday run has arrived, at 09:00', () => {
    expect(runDate(9, 0, 'arrived')).toBe(TODAY);
  });

  it('is today once yesterday run was cancelled', () => {
    expect(runDate(4, 0, 'cancelled')).toBe(TODAY);
  });

  it('is today before the evening departure when yesterday run is long gone', () => {
    expect(runDate(10, 0, 'arrived')).toBe(TODAY);
    expect(runDate(16, 0, 'arrived')).toBe(TODAY);
  });
});

describe('currentRunDate, the grace for a late run', () => {
  const GRACE_ENDS_HOUR = NDLS_ARR_MIN / 60 + LATE_RUN_GRACE_HOURS - 24;

  it('is 6 hours', () => {
    expect(LATE_RUN_GRACE_HOURS).toBe(6);
  });

  it('keeps a run current until 6 hours past its scheduled final arrival', () => {
    const hours = Math.floor(GRACE_ENDS_HOUR);
    const minutes = Math.round((GRACE_ENDS_HOUR - hours) * 60);
    expect(runDate(hours, minutes - 1, 'running')).toBe(YESTERDAY);
  });

  it('hands over to today at exactly 6 hours past the schedule, 14:32', () => {
    expect(runDate(14, 32, 'running')).toBe(TODAY);
    expect(runDate(14, 31, 'running')).toBe(YESTERDAY);
  });

  it('hands over at the grace end even when yesterday was never seen', () => {
    expect(runDate(15, 0, null)).toBe(TODAY);
  });
});

describe('currentRunDate, a train whose run ends on the day it left', () => {
  const SAME_DAY = STOPS.slice(0, 2).map((stop, index) => ({
    ...stop,
    schedArrMin: index === 0 ? null : 1100,
  }));

  it('is today, since yesterday run ended long ago', () => {
    const now = todayAt(1, 0);
    expect(currentRunDate({ stops: SAME_DAY, now, yesterday: 'running' })).toBe(TODAY);
  });
});
