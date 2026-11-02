import { describe, expect, it } from 'vitest';
import { readConfig } from './config.js';

const ENV = {
  RAILRADAR_API_KEY: 'key',
  SUPABASE_URL: 'http://db',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
};

describe('readConfig, the late check intervals', () => {
  it('takes a single interval', () => {
    const config = readConfig({ ...ENV, LATE_CHECK_INTERVALS_MIN: '15' });
    expect(config.intervals.lateMin).toEqual([15]);
  });

  it.each(['0', '5,0,10', '5,00'])('refuses a gap of zero minutes in %s', (lateMin) => {
    expect(() => readConfig({ ...ENV, LATE_CHECK_INTERVALS_MIN: lateMin })).toThrow(
      /LATE_CHECK_INTERVALS_MIN/,
    );
  });
});
