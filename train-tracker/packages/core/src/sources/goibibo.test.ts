import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseGoibiboLive } from './goibibo.js';
import type { RawFetch } from '../types.js';

const FIXTURES = join(import.meta.dirname, '../../../../fixtures/goibibo');
const RUNNING = readFileSync(
  join(FIXTURES, '12951-2026-10-30T0504IST-running-29oct-excerpt.html'),
  'utf8',
);
const STALE = readFileSync(join(FIXTURES, '12017-2026-11-02T0650IST-stale-excerpt.html'), 'utf8');
const NO_DATA = readFileSync(
  join(FIXTURES, '12017-2026-11-02T0905IST-no-data-excerpt.html'),
  'utf8',
);
const FETCHED_AT = '2026-10-29T23:34:00.000Z';
const RAW_ID = 'raw-1';
const OUR_HALTS = new Set(['BCT', 'BVI', 'ST', 'BRC', 'RTM', 'NAD', 'KOTA', 'NDLS']);

/** A RawFetch carrying the given body, as the adapter would hand it over */
function fetched(body: string, over: Partial<RawFetch> = {}): RawFetch {
  return {
    source: 'goibibo_scrape',
    url: 'https://www.goibibo.com/trains/live-train-status/12951-running-status/',
    status: 200,
    body,
    fetchedAt: FETCHED_AT,
    latencyMs: 40,
    ...over,
  };
}

const running = parseGoibiboLive(fetched(RUNNING), RAW_ID); // events and errors, from parseGoibiboLive
const stale = parseGoibiboLive(fetched(STALE), RAW_ID); // events and errors, from parseGoibiboLive

describe('parseGoibiboLive on the running 12951 page', () => {
  it('reports no errors and names the run that left Mumbai on 29 Oct', () => {
    expect(running.errors).toEqual([]);
    expect(running.journeyDate).toBe('2026-10-29');
  });

  it('emits only passed stops, so New Delhi, which only shows an expected time, has none', () => {
    expect(running.events.some((event) => event.stationCode === 'NDLS')).toBe(false);
    expect(running.events).toHaveLength(13);
  });

  it('emits a departure and no arrival at the origin, and never leaves MMCT in a code', () => {
    const origin = running.events.filter((event) => event.stationCode === 'BCT');
    expect(origin.map((event) => event.type)).toEqual(['DEP']);
    expect(running.events.some((event) => event.stationCode === 'MMCT')).toBe(false);
  });

  it('maps every halt row to one of the 8 stations of 12951', () => {
    for (const event of running.events) {
      expect(OUR_HALTS.has(event.stationCode)).toBe(true);
      expect(event.isHalt).toBe(true);
    }
  });

  it('reads IST wall times as UTC, across midnight', () => {
    const at = (stationCode: string, type: string): string | undefined =>
      running.events.find((event) => event.stationCode === stationCode && event.type === type)?.at;
    expect(at('BRC', 'ARR')).toBe('2026-10-29T15:55:00.000Z');
    expect(at('KOTA', 'DEP')).toBe('2026-10-29T22:08:00.000Z');
  });

  it('numbers halts in page order and puts nothing after the fetch', () => {
    const kota = running.events.find((event) => event.stationCode === 'KOTA');
    expect(kota?.haltOrder).toBe(6);
    expect(kota?.trainNumber).toBe('12951');
    expect(kota?.rawFetchId).toBe(RAW_ID);
    for (const event of running.events) {
      expect(Date.parse(event.at)).toBeLessThanOrEqual(Date.parse(FETCHED_AT));
    }
  });
});

describe('parseGoibiboLive on the stale 12017 page', () => {
  it('emits nothing when no stop carries an arrived or departed flag', () => {
    expect(stale.errors).toEqual([]);
    expect(stale.events).toEqual([]);
  });

  it('still names the run, so a caller can check it', () => {
    expect(stale.journeyDate).toBe('2026-11-02');
  });
});

describe('parseGoibiboLive on the No data page the site served with a 200', () => {
  it('reports the source unavailable, with no events and no errors', () => {
    expect(parseGoibiboLive(fetched(NO_DATA), RAW_ID)).toEqual({
      events: [],
      errors: [],
      journeyDate: null,
      isUnavailable: true,
    });
  });

  it('leaves isUnavailable off a page that carries data, and off a bad one', () => {
    expect(running.isUnavailable).toBeUndefined();
    expect(parseGoibiboLive(fetched('<html></html>'), RAW_ID).isUnavailable).toBeUndefined();
  });

  it('reads any other error code as a parse error', () => {
    const other = parseGoibiboLive(fetched(NO_DATA.replace('TLSV2007', 'TLSV9999')), RAW_ID);
    expect(other.isUnavailable).toBeUndefined();
    expect(other.errors.length).toBeGreaterThan(0);
  });
});

describe('parseGoibiboLive on a bad response', () => {
  const FAILURES: [string, RawFetch][] = [
    ['a fetch that failed', fetched('', { status: 0, error: 'timeout' })],
    ['a 403', fetched('Forbidden', { status: 403 })],
    ['a page without the data block', fetched('<html><body>hello</body></html>')],
    [
      'a data block that is not JSON',
      fetched('<script id="__NEXT_DATA__" type="application/json">{oops</script>'),
    ],
    ['a changed shape', fetched(RUNNING.replace('"Stations"', '"Stops"'))],
    [
      'a stop with a time that is not a clock',
      fetched(RUNNING.replace('"actualArrivalTime":"21:25"', '"actualArrivalTime":"late"')),
    ],
  ];

  for (const [name, raw] of FAILURES) {
    it(`returns errors and no events for ${name}`, () => {
      const result = parseGoibiboLive(raw, RAW_ID);
      expect(result.events).toEqual([]);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  }

  it('gives no run date when it cannot read one', () => {
    expect(parseGoibiboLive(fetched('<html></html>'), RAW_ID).journeyDate).toBeNull();
  });
});
