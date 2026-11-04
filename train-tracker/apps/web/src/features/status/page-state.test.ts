import { describe, expect, it } from 'vitest';
import { pageMessage, pageStateOf } from './page-state';
import type { Watch } from './page-state';

describe('pageStateOf', () => {
  it.each([
    ['no timetable yet, nothing asked', 0, false, false, null, 'getting-timetable'],
    ['no timetable, pending', 0, false, false, 'pending', 'getting-timetable'],
    ['no timetable, ready but not loaded yet', 0, false, false, 'ready', 'getting-timetable'],
    ['no timetable, failed', 0, false, false, 'failed', 'timetable-failed'],
    ['no timetable, request not possible', 0, false, false, 'unavailable', 'timetable-failed'],
    ['timetable but no journey', 30, false, false, 'ready', 'watching'],
    ['timetable and journey but no position', 30, true, false, null, 'no-position'],
    ['timetable, journey and position', 30, true, true, null, 'live'],
    ['an old failed request does not hide a timetable', 30, true, true, 'failed', 'live'],
    [
      'an unavailable request does not hide a timetable',
      30,
      false,
      false,
      'unavailable',
      'watching',
    ],
  ] as const)('%s', (_name, stopCount, hasJourney, hasState, watch, expected) => {
    expect(pageStateOf({ stopCount, hasJourney, hasState, watch: watch as Watch })).toBe(expected);
  });
});

describe('pageMessage', () => {
  it('names the train while getting the timetable', () => {
    expect(pageMessage('getting-timetable', '11111 Test Express')).toBe(
      'Getting the timetable for 11111 Test Express. This usually takes a couple of minutes.',
    );
  });

  it('never shows a raw reason when the timetable failed', () => {
    expect(pageMessage('timetable-failed', 'X')).toBe(
      'We couldn’t get this train’s timetable right now. Try again later.',
    );
  });

  it('says the train is being watched', () => {
    expect(pageMessage('watching', 'X')).toContain('next run');
  });
});
