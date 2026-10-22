import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalStationCode, parseRailRadarLive } from './railradar.js';
import type { RawFetch } from '../types.js';

const FIXTURES = join(import.meta.dirname, '../../../../fixtures/railradar');
const COMPLETED = join(FIXTURES, '12951-live.json');
const PREDICTED = join(FIXTURES, '12951-predicted.json');
const FETCHED_AT = '2026-10-22T03:05:26.000Z';
const RAW_ID = 'raw-1';

/** A RawFetch carrying the given body, as the adapter would hand it over */
function fetched(body: string, over: Partial<RawFetch> = {}): RawFetch {
  return {
    source: 'railradar',
    url: 'https://api.railradar.in/v1/trains/12951/live',
    status: 200,
    body,
    fetchedAt: FETCHED_AT,
    latencyMs: 8,
    ...over,
  };
}

const real = parseRailRadarLive(fetched(readFileSync(COMPLETED, 'utf8')), RAW_ID); // events and errors, from parseRailRadarLive
const predicted = parseRailRadarLive(fetched(readFileSync(PREDICTED, 'utf8')), RAW_ID); // events and errors, from parseRailRadarLive

describe('parseRailRadarLive on the real 12951 response', () => {
  it('reports no errors', () => {
    expect(real.errors).toEqual([]);
  });

  it('emits events only at commercial halts, never at the 214 passed stations', () => {
    expect(new Set(real.events.map((event) => event.stationCode))).toEqual(
      new Set(['BVI', 'ST', 'BRC', 'RTM', 'NAD', 'KOTA', 'NDLS']),
    );
  });

  it('never leaves MMCT in an event, because the stations table has no MMCT', () => {
    expect(real.events.some((event) => event.stationCode === 'MMCT')).toBe(false);
  });

  it('emits nothing at the origin, which reports no actual departure', () => {
    expect(real.events.filter((event) => event.stationCode === 'BCT')).toEqual([]);
  });

  it('emits an arrival and a departure where both are reported', () => {
    expect(real.events.filter((event) => event.stationCode === 'BVI')).toEqual([
      {
        source: 'railradar',
        trainNumber: '12951',
        journeyDate: '2026-10-21',
        stationCode: 'BVI',
        type: 'ARR',
        at: '2026-10-21T12:06:18.000Z',
        fetchedAt: FETCHED_AT,
        rawFetchId: RAW_ID,
      },
      {
        source: 'railradar',
        trainNumber: '12951',
        journeyDate: '2026-10-21',
        stationCode: 'BVI',
        type: 'DEP',
        at: '2026-10-21T12:07:29.000Z',
        fetchedAt: FETCHED_AT,
        rawFetchId: RAW_ID,
      },
    ]);
  });

  it('emits an arrival alone at KOTA, which reports no actual departure', () => {
    expect(real.events.filter((event) => event.stationCode === 'KOTA')).toEqual([
      {
        source: 'railradar',
        trainNumber: '12951',
        journeyDate: '2026-10-21',
        stationCode: 'KOTA',
        type: 'ARR',
        at: '2026-10-21T21:56:46.000Z',
        fetchedAt: FETCHED_AT,
        rawFetchId: RAW_ID,
      },
    ]);
  });

  it('emits the final arrival at the destination and no departure', () => {
    expect(real.events.filter((event) => event.stationCode === 'NDLS')).toEqual([
      {
        source: 'railradar',
        trainNumber: '12951',
        journeyDate: '2026-10-21',
        stationCode: 'NDLS',
        type: 'ARR',
        at: '2026-10-22T02:57:47.000Z',
        fetchedAt: FETCHED_AT,
        rawFetchId: RAW_ID,
      },
    ]);
  });

  it('carries the journey date of the origin departure, not of the fetch', () => {
    expect(new Set(real.events.map((event) => event.journeyDate))).toEqual(new Set(['2026-10-21']));
  });

  it('stamps every event with the fetch it came from', () => {
    for (const event of real.events) {
      expect(event.fetchedAt).toBe(FETCHED_AT);
      expect(event.rawFetchId).toBe(RAW_ID);
      expect(event.source).toBe('railradar');
    }
  });

  it('keeps events in route order', () => {
    expect(real.events.map((event) => `${event.stationCode} ${event.type}`)).toEqual([
      'BVI ARR',
      'BVI DEP',
      'ST ARR',
      'ST DEP',
      'BRC ARR',
      'BRC DEP',
      'RTM ARR',
      'RTM DEP',
      'NAD ARR',
      'NAD DEP',
      'KOTA ARR',
      'NDLS ARR',
    ]);
  });

  it('never emits a scheduled time as an event', () => {
    const scheduled = ['2026-10-21T11:30:00.000Z', '2026-10-21T11:50:00.000Z'];
    for (const at of scheduled) {
      expect(real.events.some((event) => event.at === at)).toBe(false);
    }
  });
});

describe('parseRailRadarLive on a journey that has not started', () => {
  it('emits nothing, because no time has been observed yet', () => {
    expect(predicted.events).toEqual([]);
  });

  it('treats predicted times as normal rather than as errors', () => {
    expect(predicted.errors).toEqual([]);
  });
});

describe('parseRailRadarLive on responses it must survive', () => {
  it('reports a failed fetch without throwing', () => {
    const result = parseRailRadarLive(
      fetched('', { error: 'getaddrinfo ENOTFOUND', status: 0 }),
      RAW_ID,
    );
    expect(result.events).toEqual([]);
    expect(result.errors).toEqual(['RailRadar fetch failed. getaddrinfo ENOTFOUND']);
  });

  it('names the env var to check on a 401', () => {
    const result = parseRailRadarLive(fetched('{}', { status: 401 }), RAW_ID);
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toContain('RAILRADAR_API_KEY');
  });

  it('reports a body that is not JSON', () => {
    const result = parseRailRadarLive(fetched('<html>502</html>'), RAW_ID);
    expect(result.errors).toEqual(['RailRadar body is not JSON.']);
  });

  it('reports the zod issues when the shape changed', () => {
    const result = parseRailRadarLive(fetched('{"success":true,"data":{}}'), RAW_ID);
    expect(result.events).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.join(' ')).toContain('data.trainNumber');
  });

  it('reports success false', () => {
    const body = JSON.stringify({
      success: false,
      data: { trainNumber: '12951', startDate: '2026-10-21', route: [] },
    });
    expect(parseRailRadarLive(fetched(body), RAW_ID).errors.length).toBeGreaterThan(0);
  });

  it('never throws on any of them', () => {
    for (const body of ['', 'null', '[]', '{"success":true}', '{"data":null}']) {
      expect(() => parseRailRadarLive(fetched(body), RAW_ID)).not.toThrow();
    }
  });
});

describe('canonicalStationCode', () => {
  it('rewrites the one code RailRadar disagrees on', () => {
    expect(canonicalStationCode('MMCT')).toBe('BCT');
  });

  it('leaves every other code alone', () => {
    for (const code of ['BVI', 'ST', 'BRC', 'RTM', 'NAD', 'KOTA', 'NDLS']) {
      expect(canonicalStationCode(code)).toBe(code);
    }
  });
});
