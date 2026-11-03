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

describe('readConfig, the scrape switches', () => {
  it('turns every scrape source on, within a cap of 300 fetches a day, when nothing is set', () => {
    const { scrape } = readConfig(ENV);
    expect(scrape.isEnabled).toBe(true);
    expect(scrape.sources).toEqual([
      'goibibo_scrape',
      'confirmtkt_scrape',
      'travelkhana_scrape',
      'railyatri_scrape',
      'railmitra_scrape',
    ]);
    expect(scrape.dailyCap).toBe(300);
  });

  it('switches every scrape off with SCRAPE_ENABLED=false', () => {
    expect(readConfig({ ...ENV, SCRAPE_ENABLED: 'false' }).scrape.isEnabled).toBe(false);
  });

  it('takes the sources to use from a comma list', () => {
    const config = readConfig({ ...ENV, SCRAPE_SOURCES: 'confirmtkt_scrape, railyatri_scrape' });
    expect(config.scrape.sources).toEqual(['confirmtkt_scrape', 'railyatri_scrape']);
  });

  it('refuses a source it does not know, and RailRadar, which is not a scrape', () => {
    expect(() => readConfig({ ...ENV, SCRAPE_SOURCES: 'goibibo_scrape,nope' })).toThrow(
      /SCRAPE_SOURCES/,
    );
    expect(() => readConfig({ ...ENV, SCRAPE_SOURCES: 'railradar' })).toThrow(/SCRAPE_SOURCES/);
  });

  it.each(['0', '-5', 'many'])('refuses a daily cap of %s', (cap) => {
    expect(() => readConfig({ ...ENV, SCRAPE_DAILY_CAP: cap })).toThrow(/SCRAPE_DAILY_CAP/);
  });

  it('takes a daily cap', () => {
    expect(readConfig({ ...ENV, SCRAPE_DAILY_CAP: '120' }).scrape.dailyCap).toBe(120);
  });

  it('holds the page names of 12951 for the sites that need them', () => {
    expect(readConfig(ENV).scrape.slugs['12951']).toEqual({
      travelkhana: 'Mumbai-Central---New-Delhi-Tejas-Rajdhani-Express',
      railmitra: 'mumbai-rajdhani',
    });
  });
});

describe('readConfig, the RailRadar reserve', () => {
  it('holds back 20 calls a month when nothing is set', () => {
    expect(readConfig(ENV).quota).toEqual({ monthlyBudget: 100, demoReserve: 20 });
  });

  it('takes a reserve from RAILRADAR_DEMO_RESERVE', () => {
    expect(readConfig({ ...ENV, RAILRADAR_DEMO_RESERVE: '35' }).quota.demoReserve).toBe(35);
  });

  it('allows no reserve at all', () => {
    expect(readConfig({ ...ENV, RAILRADAR_DEMO_RESERVE: '0' }).quota.demoReserve).toBe(0);
  });

  it.each(['-1', 'lots', '2.5'])('refuses a reserve of %s', (reserve) => {
    expect(() => readConfig({ ...ENV, RAILRADAR_DEMO_RESERVE: reserve })).toThrow(
      /RAILRADAR_DEMO_RESERVE/,
    );
  });
});

describe('readConfig, the worker time limit', () => {
  it('has no limit when WORKER_MAX_MINUTES is not set', () => {
    expect(readConfig(ENV).workerMaxMin).toBeNull();
  });

  it('takes WORKER_MAX_MINUTES', () => {
    expect(readConfig({ ...ENV, WORKER_MAX_MINUTES: '330' }).workerMaxMin).toBe(330);
  });

  it.each(['0', '-5', 'soon'])('refuses %s as a time limit', (minutes) => {
    expect(() => readConfig({ ...ENV, WORKER_MAX_MINUTES: minutes })).toThrow(/WORKER_MAX_MINUTES/);
  });
});
