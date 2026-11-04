import { describe, expect, it } from 'vitest';
import type { Station, TimetableStop } from '@train-tracker/core/types';
import { buildTrack } from './geometry';
import { ROUTE_12951 } from './route-12951';
import { routeFor, routeFromStops } from './route';

/** A station with optional coordinates */
function station(code: string, lon: number | null, lat: number | null): Station {
  return { code, name: `Station ${code}`, nameHi: null, lat, lon, zone: null };
}

/** A timetable stop */
function stop(seq: number, stationCode: string, km: number): TimetableStop {
  return { trainNumber: '11111', seq, stationCode, schedArrMin: null, schedDepMin: null, km };
}

const STATIONS = new Map(
  [
    station('AAA', 77, 20),
    station('BBB', 77, 21),
    station('CCC', null, null),
    station('DDD', 77, 22),
  ].map((s) => [s.code, s]),
);
const STOPS = [stop(0, 'AAA', 0), stop(1, 'BBB', 110), stop(2, 'CCC', 150), stop(3, 'DDD', 220)];

describe('routeFromStops', () => {
  it('lists stations in sequence order and skips those without coordinates', () => {
    expect(routeFromStops([...STOPS].reverse(), STATIONS).map((p) => p.code)).toEqual([
      'AAA',
      'BBB',
      'DDD',
    ]);
  });

  it('skips stations that are not known', () => {
    expect(routeFromStops([stop(0, 'ZZZ', 0)], STATIONS)).toEqual([]);
  });

  it('keeps a station once when a train stops there twice', () => {
    expect(routeFromStops([...STOPS, stop(4, 'AAA', 300)], STATIONS)).toHaveLength(3);
  });
});

describe('routeFor', () => {
  it('uses the detailed route and its names for 12951', () => {
    const route = routeFor('12951', [], new Map());
    expect(route.points).toBe(ROUTE_12951);
    expect(route.detail.hindiNames['BCT']).toBe('मुंबई सेंट्रल');
  });

  it('draws other trains through their stops, with no Hindi names', () => {
    const route = routeFor('11111', STOPS, STATIONS);
    expect(route.points).toHaveLength(3);
    expect(route.detail.hindiNames).toEqual({});
  });

  it('builds a track whose length follows the stops', () => {
    const route = routeFor('11111', STOPS, STATIONS);
    const track = buildTrack(route.points, STOPS, STATIONS, route.detail);
    expect(track?.points.map((p) => p.code)).toEqual(['AAA', 'BBB', 'DDD']);
    expect(track?.points.every((p) => p.isStop && !p.isMajor && p.nameHi === '')).toBe(true);
  });

  it('builds no track with fewer than two drawable stops', () => {
    const route = routeFor('11111', [stop(0, 'AAA', 0), stop(1, 'CCC', 50)], STATIONS);
    expect(buildTrack(route.points, STOPS, STATIONS, route.detail)).toBeNull();
  });
});
