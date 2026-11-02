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
