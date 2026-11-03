import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfirmTktLive } from './confirmtkt.js';
import { parseRailYatriLive, railyatriTrainData } from './railyatri.js';
import type { RawFetch, SourceEvent } from '../types.js';

const FIXTURES = join(import.meta.dirname, '../../../../fixtures');
const page = (path: string): string => readFileSync(join(FIXTURES, path), 'utf8');
const MID_RUN = page('railyatri/12017-2026-11-02T0904IST-running.html');
const JUST_LEFT = page('railyatri/12017-2026-11-02T0648IST-running.html');
const NOT_STARTED = page('railyatri/12951-2026-10-30T0510IST-shows-next-run.html');
const CONFIRMTKT = page('confirmtkt/12017-2026-11-02T0907IST-running.html');
const FETCHED_AT = '2026-11-02T03:34:47.000Z';
const RAW_ID = 'raw-1';
const AGREE_WITHIN_MIN = 3;

/** A RawFetch carrying the given body, as the adapter would hand it over */
function fetched(body: string, over: Partial<RawFetch> = {}): RawFetch {
  return {
    source: 'railyatri_scrape',
    url: 'https://www.railyatri.in/live-train-status/12017',
    status: 200,
    body,
    fetchedAt: FETCHED_AT,
    latencyMs: 200,
    ...over,
  };
}

/** What each event says, without the fields that differ between sources */
function facts(events: readonly SourceEvent[]): string[] {
  return events.map((event) => `${event.stationCode} ${event.type} ${event.at}`).sort();
}

const midRun = parseRailYatriLive(fetched(MID_RUN), RAW_ID); // events and errors, from parseRailYatriLive
const justLeft = parseRailYatriLive(fetched(JUST_LEFT), RAW_ID); // events and errors, from parseRailYatriLive
const notStarted = parseRailYatriLive(fetched(NOT_STARTED), RAW_ID); // events and errors, from parseRailYatriLive
const confirmtkt = parseConfirmTktLive(
  { ...fetched(CONFIRMTKT), source: 'confirmtkt_scrape' },
  RAW_ID,
); // events and errors, from parseConfirmTktLive

describe('parseRailYatriLive on 12017 part way through its run', () => {
  it('reports no errors and names the run from train_start_date', () => {
    expect(midRun.errors).toEqual([]);
    expect(midRun.journeyDate).toBe('2026-11-02');
  });

  it('reads eta and etd of each passed halt as the actual times, in IST', () => {
    expect(facts(midRun.events)).toEqual([
      'GZB ARR 2026-11-02T01:53:00.000Z',
      'GZB DEP 2026-11-02T01:57:00.000Z',
      'MTC ARR 2026-11-02T02:50:00.000Z',
      'MTC DEP 2026-11-02T02:52:00.000Z',
      'NDLS DEP 2026-11-02T01:15:00.000Z',
    ]);
  });

  it('emits no arrival at the origin and numbers halts from the stoppage number', () => {
    expect(midRun.events.filter((event) => event.stationCode === 'NDLS')).toHaveLength(1);
    const meerut = midRun.events.find((event) => event.stationCode === 'MTC');
    expect(meerut?.haltOrder).toBe(2);
    expect(meerut?.isHalt).toBe(true);
    expect(meerut?.trainNumber).toBe('12017');
  });

  it('leaves out the upcoming stops and the halt it says it has just left', () => {
    const codes = new Set(midRun.events.map((event) => event.stationCode));
    expect(codes).toEqual(new Set(['NDLS', 'GZB', 'MTC']));
  });

  it('puts nothing after the fetch', () => {
    for (const event of midRun.events) {
      expect(Date.parse(event.at)).toBeLessThanOrEqual(Date.parse(FETCHED_AT));
    }
  });

  it('stays within a few minutes of ConfirmTkt, a different family, for the same run', () => {
    const theirs = new Map(confirmtkt.events.map((e) => [`${e.stationCode} ${e.type}`, e.at]));
    for (const event of midRun.events) {
      const other = theirs.get(`${event.stationCode} ${event.type}`);
      expect(other).toBeDefined();
      const gapMin = Math.abs(Date.parse(event.at) - Date.parse(other ?? '')) / 60_000;
      expect(gapMin).toBeLessThanOrEqual(AGREE_WITHIN_MIN);
    }
  });

  it('moves a departure past midnight to the next day', () => {
    const late = MID_RUN.replace('"eta":"08:20","etd":"08:22"', '"eta":"23:58","etd":"00:03"');
    const result = parseRailYatriLive(fetched(late), RAW_ID);
    const departure = result.events.find((e) => e.stationCode === 'MTC' && e.type === 'DEP');
    expect(departure?.at).toBe('2026-11-02T18:33:00.000Z');
  });
});

describe('parseRailYatriLive on 12017 just after it left New Delhi', () => {
  it('emits only the departure from the origin', () => {
    expect(justLeft.errors).toEqual([]);
    expect(facts(justLeft.events)).toEqual(['NDLS DEP 2026-11-02T01:15:00.000Z']);
  });
});

describe('parseRailYatriLive on a run that has not started', () => {
  it('emits nothing, because the page has no passed stops, and names the run it shows', () => {
    expect(notStarted.errors).toEqual([]);
    expect(notStarted.events).toEqual([]);
    expect(notStarted.journeyDate).toBe('2026-10-30');
  });
});

describe('parseRailYatriLive on a bad response', () => {
  const FAILURES: [string, RawFetch][] = [
    ['a fetch that failed', fetched('', { status: 0, error: 'timeout' })],
    ['a 403', fetched('Forbidden', { status: 403 })],
    ['a page without the data block', fetched('<html><body>hello</body></html>')],
    [
      'a data block that is not JSON',
      fetched('<script id="__NEXT_DATA__" type="application/json">{oops</script>'),
    ],
    ['a changed shape', fetched(MID_RUN.replace('"previous_stations"', '"passed_stations"'))],
    ['a time that is not a clock', fetched(MID_RUN.replace('"eta":"08:20"', '"eta":"soon"'))],
  ];

  for (const [name, raw] of FAILURES) {
    it(`returns errors and no events for ${name}`, () => {
      const result = parseRailYatriLive(raw, RAW_ID);
      expect(result.events).toEqual([]);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  }
});

describe('railyatriTrainData', () => {
  it('keeps ltsData, a fraction of the page, which the parser still reads exactly as before', () => {
    const kept = railyatriTrainData(MID_RUN);
    expect(kept?.length).toBeLessThan(MID_RUN.length / 2);
    expect(parseRailYatriLive(fetched(kept ?? ''), RAW_ID)).toEqual(midRun);
  });

  it('keeps a run that has not started as it was', () => {
    const kept = railyatriTrainData(NOT_STARTED);
    expect(parseRailYatriLive(fetched(kept ?? ''), RAW_ID)).toEqual(notStarted);
  });

  it('returns null for a page with no ltsData', () => {
    expect(railyatriTrainData('<html>hello</html>')).toBeNull();
  });
});
