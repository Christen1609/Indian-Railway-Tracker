import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { confirmtktTrainData, parseConfirmTktLive } from './confirmtkt.js';
import { parseGoibiboLive } from './goibibo.js';
import type { RawFetch, SourceEvent } from '../types.js';

const CONFIRMTKT = join(import.meta.dirname, '../../../../fixtures/confirmtkt');
const GOIBIBO = join(import.meta.dirname, '../../../../fixtures/goibibo');
const NOT_STARTED = readFileSync(
  join(CONFIRMTKT, '12951-2026-10-30T0434IST-default-today.html'),
  'utf8',
);
const RUNNING = readFileSync(
  join(CONFIRMTKT, '12951-2026-10-30T0435IST-date-29oct-running.html'),
  'utf8',
);
const JUST_LEFT = readFileSync(join(CONFIRMTKT, '12017-2026-11-02T0651IST-running.html'), 'utf8');
const GOIBIBO_RUNNING = readFileSync(
  join(GOIBIBO, '12951-2026-10-30T0504IST-running-29oct-excerpt.html'),
  'utf8',
);
const FETCHED_AT = '2026-10-29T23:05:00.000Z';
const RAW_ID = 'raw-1';
const OUR_HALTS = new Set(['BCT', 'BVI', 'ST', 'BRC', 'RTM', 'NAD', 'KOTA', 'NDLS']);

/** A RawFetch carrying the given body, as the adapter would hand it over */
function fetched(body: string, over: Partial<RawFetch> = {}): RawFetch {
  return {
    source: 'confirmtkt_scrape',
    url: 'https://www.confirmtkt.com/train-running-status/12951?Date=29-Oct-2026',
    status: 200,
    body,
    fetchedAt: FETCHED_AT,
    latencyMs: 90,
    ...over,
  };
}

/** What each event says, without the fields that differ between sources */
function facts(events: readonly SourceEvent[]): string[] {
  return events.map((event) => `${event.stationCode} ${event.type} ${event.at}`).sort();
}

const notStarted = parseConfirmTktLive(fetched(NOT_STARTED), RAW_ID); // events and errors, from parseConfirmTktLive
const running = parseConfirmTktLive(fetched(RUNNING), RAW_ID); // events and errors, from parseConfirmTktLive
const justLeft = parseConfirmTktLive(fetched(JUST_LEFT), RAW_ID); // events and errors, from parseConfirmTktLive
const goibibo = parseGoibiboLive({ ...fetched(GOIBIBO_RUNNING), source: 'goibibo_scrape' }, RAW_ID); // events and errors, from parseGoibiboLive

describe('parseConfirmTktLive on the page for a run that has not started', () => {
  it('emits nothing, because no row carries the passed tick', () => {
    expect(notStarted.errors).toEqual([]);
    expect(notStarted.events).toEqual([]);
  });

  it('names the run it shows, 30 Oct, so a caller can tell it from the one asked for', () => {
    expect(notStarted.journeyDate).toBe('2026-10-30');
  });
});

describe('parseConfirmTktLive on the running 12951 page for 29 Oct', () => {
  it('reports no errors and names the run that left Mumbai on 29 Oct', () => {
    expect(running.errors).toEqual([]);
    expect(running.journeyDate).toBe('2026-10-29');
  });

  it('emits only ticked halts, not New Delhi, which shows an expected time, nor Indargarh', () => {
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
    const newYear = RUNNING.replaceAll('29-Oct', '31-Dec').replaceAll('30-Oct', '01-Jan');
    const result = parseConfirmTktLive(fetched(newYear), RAW_ID);
    const kota = result.events.find((e) => e.stationCode === 'KOTA' && e.type === 'DEP');
    expect(result.journeyDate).toBe('2026-12-31');
    expect(kota?.at).toBe('2026-12-31T22:08:00.000Z');
  });
});

describe('parseConfirmTktLive on 12017 just after it left New Delhi', () => {
  it('emits the one departure it has seen and nothing from Shivaji Bridge, which is no halt', () => {
    expect(justLeft.errors).toEqual([]);
    expect(facts(justLeft.events)).toEqual(['NDLS DEP 2026-11-02T01:15:00.000Z']);
    expect(justLeft.journeyDate).toBe('2026-11-02');
  });
});

describe('parseConfirmTktLive on a bad response', () => {
  const FAILURES: [string, RawFetch][] = [
    ['a fetch that failed', fetched('', { status: 0, error: 'timeout' })],
    ['a 403', fetched('Forbidden', { status: 403 })],
    ['a page with no table', fetched('<html><body>hello</body></html>')],
    ['a changed row layout', fetched(RUNNING.replaceAll('rs__station-name', 'rs__stn'))],
    [
      'a passed row that is not in the station list',
      fetched(RUNNING.replace('>Kota Jn<', '>Kotah<')),
    ],
    ['more station codes than halt rows', fetched(NOT_STARTED.replace('>Nagda Jn<', '>Nagda<'))],
    [
      'a time that is not a clock',
      fetched(RUNNING.replace('<span>03:30</span>', '<span>late</span>')),
    ],
  ];

  for (const [name, raw] of FAILURES) {
    it(`returns errors and no events for ${name}`, () => {
      const result = parseConfirmTktLive(raw, RAW_ID);
      expect(result.events).toEqual([]);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  }

  it('gives no run date when it cannot read one', () => {
    expect(parseConfirmTktLive(fetched('<html></html>'), RAW_ID).journeyDate).toBeNull();
  });
});

describe('confirmtktTrainData', () => {
  it.each([
    ['a running page', RUNNING, running],
    ['a page for a run not started', NOT_STARTED, notStarted],
    ['a page just after departure', JUST_LEFT, justLeft],
  ])(
    'keeps the status rows of %s, which the parser reads exactly as before',
    (_name, page, parsed) => {
      const kept = confirmtktTrainData(page);
      expect(kept?.length).toBeLessThan(page.length / 2);
      expect(parseConfirmTktLive(fetched(kept ?? ''), RAW_ID)).toEqual(parsed);
    },
  );

  it('returns null for a page with no status rows', () => {
    expect(confirmtktTrainData('<html>hello</html>')).toBeNull();
  });
});

describe('parseConfirmTktLive, when the page was updated', () => {
  it('reads Last Updated as IST and gives it as UTC', () => {
    expect(running.updatedAt).toBe('2026-10-29T22:55:00.000Z');
    expect(notStarted.updatedAt).toBe('2026-10-28T18:35:00.000Z');
    expect(justLeft.updatedAt).toBe('2026-11-02T01:20:00.000Z');
  });

  it('still reads the events when Last Updated is missing, and gives none', () => {
    const odd = parseConfirmTktLive(fetched(RUNNING.replace('Last Updated:', 'Checked:')), RAW_ID);
    expect(odd.events).toEqual(running.events);
    expect(odd.updatedAt).toBeUndefined();
  });
});
