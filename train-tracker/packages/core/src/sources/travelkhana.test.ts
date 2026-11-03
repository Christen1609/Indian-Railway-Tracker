import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseGoibiboLive } from './goibibo.js';
import { parseTravelkhanaLive, travelkhanaTrainData } from './travelkhana.js';
import type { RawFetch, SourceEvent } from '../types.js';

const FIXTURES = join(import.meta.dirname, '../../../../fixtures');
const PAGE = readFileSync(
  join(FIXTURES, 'travelkhana/12951-2026-10-30T0459IST-running-29oct.html'),
  'utf8',
);
const LATE_RUN = readFileSync(
  join(FIXTURES, 'travelkhana/12951-2026-11-02T0902IST-running-01nov.html'),
  'utf8',
);
const GOIBIBO_RUNNING = readFileSync(
  join(FIXTURES, 'goibibo/12951-2026-10-30T0504IST-running-29oct-excerpt.html'),
  'utf8',
);
const FETCHED_AT = '2026-10-29T23:29:00.000Z';
const RAW_ID = 'raw-1';
const OUR_HALTS = new Set(['BCT', 'BVI', 'ST', 'BRC', 'RTM', 'NAD', 'KOTA', 'NDLS']);

/** A RawFetch carrying the given body, as the adapter would hand it over */
function fetched(body: string, over: Partial<RawFetch> = {}): RawFetch {
  return {
    source: 'travelkhana_scrape',
    url: 'https://www.travelkhana.com/travelkhana/track-train/12951-Mumbai-Central---New-Delhi-Tejas-Rajdhani-Express',
    status: 200,
    body,
    fetchedAt: FETCHED_AT,
    latencyMs: 120,
    ...over,
  };
}

/** What each event says, without the fields that differ between sources */
function facts(events: readonly SourceEvent[]): string[] {
  return events.map((event) => `${event.stationCode} ${event.type} ${event.at}`).sort();
}

const running = parseTravelkhanaLive(fetched(PAGE), RAW_ID, '2026-10-29'); // events and errors, from parseTravelkhanaLive
const finished = parseTravelkhanaLive(fetched(PAGE), RAW_ID, '2026-10-28'); // events and errors, from parseTravelkhanaLive
const goibibo = parseGoibiboLive(fetched(GOIBIBO_RUNNING), RAW_ID); // events and errors, from parseGoibiboLive

describe('parseTravelkhanaLive on the run that left Mumbai on 29 Oct', () => {
  it('reports no errors and names the run', () => {
    expect(running.errors).toEqual([]);
    expect(running.journeyDate).toBe('2026-10-29');
  });

  it('emits only passed stops, so New Delhi, which only shows its timetabled time, has none', () => {
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

  it('dates a row by its day count, and puts nothing after the fetch', () => {
    const kota = running.events.find((e) => e.stationCode === 'KOTA' && e.type === 'DEP');
    expect(kota?.at).toBe('2026-10-29T22:08:00.000Z');
    expect(kota?.haltOrder).toBe(6);
    for (const event of running.events) {
      expect(Date.parse(event.at)).toBeLessThanOrEqual(Date.parse(FETCHED_AT));
    }
  });
});

describe('parseTravelkhanaLive on the run that left on 28 Oct, which has finished', () => {
  it('emits the final arrival at New Delhi and no departure from it', () => {
    expect(finished.errors).toEqual([]);
    const delhi = finished.events.filter((event) => event.stationCode === 'NDLS');
    expect(facts(delhi)).toEqual(['NDLS ARR 2026-10-29T03:12:00.000Z']);
  });

  it('emits an arrival only where the page shows Arrived and no departure time', () => {
    const borivali = finished.events.filter((event) => event.stationCode === 'BVI');
    expect(borivali.map((event) => event.type)).toEqual(['ARR']);
    expect(finished.events).toHaveLength(12);
  });
});

describe('parseTravelkhanaLive on a run that is hours late', () => {
  const late = parseTravelkhanaLive(fetched(LATE_RUN), RAW_ID, '2026-11-01'); // events and errors, from parseTravelkhanaLive

  it('reads a late-by-hours status on the upcoming stop as not passed', () => {
    expect(late.errors).toEqual([]);
    expect(late.events).toHaveLength(13);
    expect(late.events.some((event) => event.stationCode === 'NDLS')).toBe(false);
  });

  it('emits nothing for the run listed above it that has not started', () => {
    const next = parseTravelkhanaLive(fetched(LATE_RUN), RAW_ID, '2026-11-02');
    expect(next).toEqual({
      events: [],
      errors: [],
      journeyDate: '2026-11-02',
      updatedAt: '2026-11-02T03:22:00.000Z',
    });
  });
});

describe('parseTravelkhanaLive on a run the page does not list', () => {
  it('returns no events, no errors and no run date, so the caller sees the wrong run', () => {
    const result = parseTravelkhanaLive(fetched(PAGE), RAW_ID, '2026-10-30');
    expect(result).toEqual({ events: [], errors: [], journeyDate: null });
  });
});

describe('parseTravelkhanaLive on a bad response', () => {
  const FAILURES: [string, RawFetch][] = [
    ['a fetch that failed', fetched('', { status: 0, error: 'timeout' })],
    ['a 403', fetched('Forbidden', { status: 403 })],
    ['a page without the run table', fetched('<html><body>hello</body></html>')],
    ['a status it does not know', fetched(PAGE.replaceAll('>On Time <', '>Cancelled <'))],
    ['a time that is not a clock', fetched(PAGE.replace('17:31/17:20', 'soon/17:20'))],
    ['a station without a code', fetched(PAGE.replace('<p>SURAT (ST)</p>', '<p>SURAT</p>'))],
  ];

  for (const [name, raw] of FAILURES) {
    it(`returns errors and no events for ${name}`, () => {
      const result = parseTravelkhanaLive(raw, RAW_ID, '2026-10-29');
      expect(result.events).toEqual([]);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  }
});

describe('travelkhanaTrainData', () => {
  it('keeps the tables of every run, which the parser reads exactly as before for each', () => {
    const kept = travelkhanaTrainData(PAGE);
    expect(kept?.length).toBeLessThan(PAGE.length);
    for (const date of ['2026-10-29', '2026-10-28', '2026-10-30']) {
      const whole = parseTravelkhanaLive(fetched(PAGE), RAW_ID, date);
      expect(parseTravelkhanaLive(fetched(kept ?? ''), RAW_ID, date)).toEqual(whole);
    }
  });

  it('returns null for a page with no run tables', () => {
    expect(travelkhanaTrainData('<html>hello</html>')).toBeNull();
  });
});

describe('parseTravelkhanaLive, when the page was updated', () => {
  it('reads the Last Updated of the run asked for as IST and gives it as UTC', () => {
    expect(running.updatedAt).toBe('2026-10-29T23:24:00.000Z');
    const late = parseTravelkhanaLive(fetched(LATE_RUN), RAW_ID, '2026-11-01');
    expect(late.updatedAt).toBe('2026-11-02T03:22:00.000Z');
  });

  it('gives none when the run is not on the page', () => {
    expect(parseTravelkhanaLive(fetched(PAGE), RAW_ID, '2026-10-30').updatedAt).toBeUndefined();
  });
});
