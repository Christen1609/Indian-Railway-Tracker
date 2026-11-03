import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseGoibiboLive } from './goibibo.js';
import { parseRailmitraLive, railmitraTrainData } from './railmitra.js';
import type { RawFetch, SourceEvent } from '../types.js';

const FIXTURES = join(import.meta.dirname, '../../../../fixtures');
const PAGE = readFileSync(
  join(FIXTURES, 'railmitra/12951-2026-10-30T0512IST-day-yesterday.html'),
  'utf8',
);
const SERVICE_ERROR = readFileSync(
  join(FIXTURES, 'railmitra/12951-2026-11-02T0903IST-service-error.html'),
  'utf8',
);
const GOIBIBO_RUNNING = readFileSync(
  join(FIXTURES, 'goibibo/12951-2026-10-30T0504IST-running-29oct-excerpt.html'),
  'utf8',
);
const FETCHED_AT = '2026-10-29T23:42:00.000Z';
const RAW_ID = 'raw-1';
const OUR_HALTS = new Set(['BCT', 'BVI', 'ST', 'BRC', 'RTM', 'NAD', 'KOTA', 'NDLS']);

/** A RawFetch carrying the given body, as the adapter would hand it over */
function fetched(body: string, over: Partial<RawFetch> = {}): RawFetch {
  return {
    source: 'railmitra_scrape',
    url: 'https://www.railmitra.com/live-train-running-status/mumbai-rajdhani-12951?day=yesterday',
    status: 200,
    body,
    fetchedAt: FETCHED_AT,
    latencyMs: 150,
    ...over,
  };
}

/** What each event says, without the fields that differ between sources */
function facts(events: readonly SourceEvent[]): string[] {
  return events.map((event) => `${event.stationCode} ${event.type} ${event.at}`).sort();
}

const running = parseRailmitraLive(fetched(PAGE), RAW_ID); // events and errors, from parseRailmitraLive
const goibibo = parseGoibiboLive(fetched(GOIBIBO_RUNNING), RAW_ID); // events and errors, from parseGoibiboLive

describe('parseRailmitraLive on the running 12951 page for yesterday', () => {
  it('reports no errors and names the run that left Mumbai on 29 Oct', () => {
    expect(running.errors).toEqual([]);
    expect(running.journeyDate).toBe('2026-10-29');
  });

  it('emits nothing for New Delhi, whose open circle and expected 08:40 mark it as not reached', () => {
    expect(running.events.some((event) => event.stationCode === 'NDLS')).toBe(false);
    expect(running.events).toHaveLength(13);
  });

  it('emits a departure and no arrival at the origin, under BCT and never MMCT', () => {
    const origin = running.events.filter((event) => event.stationCode === 'BCT');
    expect(origin.map((event) => event.type)).toEqual(['DEP']);
    expect(running.events.some((event) => event.stationCode === 'MMCT')).toBe(false);
  });

  it('maps every halt row to one of the 8 stations of 12951', () => {
    for (const event of running.events) {
      expect(OUR_HALTS.has(event.stationCode)).toBe(true);
      expect(event.isHalt).toBe(true);
      expect(event.trainNumber).toBe('12951');
    }
  });

  it('gives the same facts as Goibibo for the same run, as DATA_SOURCES.md says', () => {
    expect(facts(running.events)).toEqual(facts(goibibo.events));
  });

  it('reads dates across midnight and puts nothing after the fetch', () => {
    const kota = running.events.find((e) => e.stationCode === 'KOTA' && e.type === 'DEP');
    expect(kota?.at).toBe('2026-10-29T22:08:00.000Z');
    expect(kota?.haltOrder).toBe(6);
    for (const event of running.events) {
      expect(Date.parse(event.at)).toBeLessThanOrEqual(Date.parse(FETCHED_AT));
    }
  });

  it('rolls the year over when a run crosses 31 Dec', () => {
    const newYear = PAGE.replaceAll('29-Oct', '31-Dec').replaceAll('30-Oct', '01-Jan');
    const result = parseRailmitraLive(fetched(newYear), RAW_ID);
    const kota = result.events.find((e) => e.stationCode === 'KOTA' && e.type === 'DEP');
    expect(result.journeyDate).toBe('2026-12-31');
    expect(kota?.at).toBe('2026-12-31T22:08:00.000Z');
  });
});

describe('parseRailmitraLive on the Oops page the site served with a 200', () => {
  it('reports the source unavailable, with no events and no errors', () => {
    expect(parseRailmitraLive(fetched(SERVICE_ERROR), RAW_ID)).toEqual({
      events: [],
      errors: [],
      journeyDate: null,
      isUnavailable: true,
    });
  });

  it('does not call a page unavailable when it also carries station rows', () => {
    const result = parseRailmitraLive(fetched(PAGE), RAW_ID);
    expect(result.isUnavailable).toBeUndefined();
  });
});

describe('parseRailmitraLive on a bad response', () => {
  const FAILURES: [string, RawFetch][] = [
    ['a fetch that failed', fetched('', { status: 0, error: 'timeout' })],
    ['a 403', fetched('Forbidden', { status: 403 })],
    ['a page without station rows', fetched('<html><body>hello</body></html>')],
    ['a changed row layout', fetched(PAGE.replaceAll('<span class=ind-', '<span class=x-'))],
    ['a marker it does not know', fetched(PAGE.replace('fa-circle-thin', 'fa-star'))],
    [
      'a current station under a status it does not know',
      fetched(PAGE.replace('Train Departed from', 'Train Is Halted at')),
    ],
    ['a time that is not a clock', fetched(PAGE.replace('<b>03:30</b>', '<b>late</b>'))],
  ];

  for (const [name, raw] of FAILURES) {
    it(`returns errors and no events for ${name}`, () => {
      const result = parseRailmitraLive(raw, RAW_ID);
      expect(result.events).toEqual([]);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  }

  it('gives no run date when it cannot read one', () => {
    expect(parseRailmitraLive(fetched('<html></html>'), RAW_ID).journeyDate).toBeNull();
  });
});

describe('railmitraTrainData', () => {
  it('keeps the heading, date and station rows, which the parser reads exactly as before', () => {
    const kept = railmitraTrainData(PAGE);
    expect(kept?.length).toBeLessThan(PAGE.length / 2);
    expect(parseRailmitraLive(fetched(kept ?? ''), RAW_ID)).toEqual(running);
  });

  it('returns null for the Oops page, which has no rows, so that it is kept whole', () => {
    expect(railmitraTrainData(SERVICE_ERROR)).toBeNull();
  });
});
