import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseGoibiboTimetable } from './goibibo.js';
import type { RawFetch } from '../types.js';

const FIXTURES = join(import.meta.dirname, '../../../../fixtures/goibibo');
const KARNATAKA = readFileSync(
  join(FIXTURES, '12627-2026-11-04T1055IST-timetable-excerpt.html'),
  'utf8',
);
const JHELUM = readFileSync(
  join(FIXTURES, '11077-2026-11-04T1055IST-timetable-excerpt.html'),
  'utf8',
);
const RUNNING = readFileSync(
  join(FIXTURES, '12951-2026-10-30T0504IST-running-29oct-excerpt.html'),
  'utf8',
);

/** A RawFetch carrying the given body, as the adapter would hand it over */
function fetched(body: string, over: Partial<RawFetch> = {}): RawFetch {
  return {
    source: 'goibibo_scrape',
    url: 'https://www.goibibo.com/trains/live-train-status/12627-running-status/',
    status: 200,
    body,
    fetchedAt: '2026-11-04T05:25:00.000Z',
    latencyMs: 40,
    ...over,
  };
}

const karnataka = parseGoibiboTimetable(fetched(KARNATAKA)); // halts and run days, from parseGoibiboTimetable
const jhelum = parseGoibiboTimetable(fetched(JHELUM)); // halts and run days, from parseGoibiboTimetable

describe('parseGoibiboTimetable on the 12627 page', () => {
  it('reads all 35 halts in order with no errors', () => {
    expect(karnataka.errors).toEqual([]);
    expect(karnataka.halts).toHaveLength(35);
    expect(karnataka.halts.map((halt) => halt.seq)).toEqual(karnataka.halts.map((_, i) => i));
  });

  it('has no arrival at the origin and no departure at the terminus', () => {
    const first = karnataka.halts[0];
    const last = karnataka.halts[karnataka.halts.length - 1];
    expect(first).toMatchObject({
      stationCode: 'SBC',
      schedArrMin: null,
      schedDepMin: 1160,
      km: 0,
    });
    expect(last).toMatchObject({ stationCode: 'NDLS', schedDepMin: null, km: 2395 });
    expect(last?.schedArrMin).toBe(2 * 1440 + 9 * 60);
  });

  it('counts minutes from midnight IST on day 1, across midnight', () => {
    const guntakal = karnataka.halts.find((halt) => halt.stationCode === 'GTL');
    expect(guntakal).toMatchObject({ schedArrMin: 1465, schedDepMin: 1470, km: 320 });
  });

  it('carries each halt name and coordinates', () => {
    expect(karnataka.halts[0]).toMatchObject({
      name: 'KSR BENGALURU',
      lat: 12.97759,
      lon: 77.5684,
    });
  });

  it('never goes back in time along the route', () => {
    const times = karnataka.halts.flatMap((halt) => [halt.schedArrMin, halt.schedDepMin]);
    const known = times.filter((one): one is number => one !== null);
    expect(known).toEqual([...known].sort((a, b) => a - b));
  });

  it('reads a train that runs every day as 127', () => {
    expect(karnataka.runsOn).toBe(127);
  });
});

describe('parseGoibiboTimetable on the 11077 page', () => {
  it('reads all 66 halts, ending at Jammu Tawi on day 3', () => {
    expect(jhelum.errors).toEqual([]);
    expect(jhelum.halts).toHaveLength(66);
    expect(jhelum.halts[0]?.stationCode).toBe('PUNE');
    expect(jhelum.halts[jhelum.halts.length - 1]).toMatchObject({
      stationCode: 'JAT',
      schedArrMin: 2 * 1440 + 600,
      km: 2174,
    });
  });
});

describe('parseGoibiboTimetable, run days', () => {
  const only = (days: string): string =>
    KARNATAKA.replace(/"DaysOfRun":\{[^}]*\}/, `"DaysOfRun":{${days}}`);
  const off = '"Mon":false,"Tue":false,"Wed":false,"Thu":false,"Fri":false,"Sat":false,"Sun":false';

  it('puts Monday at 1 and Sunday at 64', () => {
    expect(
      parseGoibiboTimetable(fetched(only(off.replace('"Mon":false', '"Mon":true')))).runsOn,
    ).toBe(1);
    expect(
      parseGoibiboTimetable(fetched(only(off.replace('"Sun":false', '"Sun":true')))).runsOn,
    ).toBe(64);
  });

  it('gives none when the page carries no run days', () => {
    const bare = parseGoibiboTimetable(fetched(KARNATAKA.replace(/"DaysOfRun":\{[^}]*\},/, '')));
    expect(bare.errors).toEqual([]);
    expect(bare.runsOn).toBeNull();
  });
});

describe('parseGoibiboTimetable on a bad response', () => {
  const cases: [string, RawFetch][] = [
    ['a fetch error', fetched('', { status: 0, error: 'timed out' })],
    ['a 503', fetched('busy', { status: 503 })],
    ['a page with no __NEXT_DATA__', fetched('<html></html>')],
    [
      'a __NEXT_DATA__ that is not JSON',
      fetched('<script id="__NEXT_DATA__" type="application/json">{oops</script>'),
    ],
    ['a live page with no timetable', fetched(RUNNING)],
    [
      'a timetable with no halts',
      fetched(KARNATAKA.replace(/"Stations":\[.*\]\}\}\}\}\}\}/s, '"Stations":[]}}}}}}')),
    ],
    [
      'a time that is not a time',
      fetched(
        KARNATAKA.replace('"scheduledDepartureTime":"19:20"', '"scheduledDepartureTime":"7pm"'),
      ),
    ],
  ];

  for (const [name, raw] of cases) {
    it(`returns errors and no halts for ${name}`, () => {
      const result = parseGoibiboTimetable(raw);
      expect(result.halts).toEqual([]);
      expect(result.runsOn).toBeNull();
      expect(result.errors.length).toBeGreaterThan(0);
    });
  }
});
