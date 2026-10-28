import { describe, expect, it } from 'vitest';
import type { TimetableStop } from '@train-tracker/core/types';
import {
  alongKmOf,
  bearingDeg,
  buildTrack,
  cutBetween,
  haversineKm,
  headingAt,
  nextIndex,
  pointAt,
  renderScale,
  totalAlongKm,
  trainFeatures,
} from './geometry';
import type { Track } from './geometry';
import { ROUTE_12951 } from './route-12951';

const STOPS: TimetableStop[] = [
  ['BCT', 0],
  ['BVI', 30],
  ['ST', 263.6],
  ['BRC', 393.2],
  ['RTM', 653.6],
  ['NAD', 697.4],
  ['KOTA', 922.8],
  ['NDLS', 1388.4],
].map(([stationCode, km], seq) => ({
  trainNumber: '12951',
  seq,
  stationCode: String(stationCode),
  schedArrMin: null,
  schedDepMin: null,
  km: Number(km),
}));

const built = buildTrack(ROUTE_12951, STOPS, new Map());
if (built === null) {
  throw new Error('the 12951 route should build into a track');
}
const track: Track = built;

/** The route point with a station code */
function pointOf(code: string) {
  const point = track.points.find((candidate) => candidate.code === code);
  if (point === undefined) {
    throw new Error(`no route point ${code}`);
  }
  return point;
}

describe('haversineKm', () => {
  it('measures one degree of latitude as about 111 km', () => {
    expect(haversineKm({ lon: 0, lat: 0 }, { lon: 0, lat: 1 })).toBeCloseTo(111.19, 1);
  });

  it('is zero between a place and itself', () => {
    expect(haversineKm({ lon: 72.8, lat: 19 }, { lon: 72.8, lat: 19 })).toBe(0);
  });
});

describe('bearingDeg', () => {
  it.each([
    ['north', { lon: 0, lat: 1 }, 0],
    ['east', { lon: 1, lat: 0 }, 90],
    ['south', { lon: 0, lat: -1 }, 180],
    ['west', { lon: -1, lat: 0 }, 270],
  ])('points %s', (_name, to, expected) => {
    expect(bearingDeg({ lon: 0, lat: 0 }, to)).toBeCloseTo(expected, 5);
  });
});

describe('buildTrack', () => {
  it('anchors the timetable stops in order along the route', () => {
    const alongs = track.anchors.map((anchor) => anchor.alongKm);
    expect(track.anchors).toHaveLength(STOPS.length);
    expect(alongs).toEqual([...alongs].sort((a, b) => a - b));
  });

  it('marks exactly the timetable stops', () => {
    expect(track.points.filter((point) => point.isStop).map((point) => point.code)).toEqual(
      STOPS.map((stop) => stop.stationCode),
    );
  });

  it('gives route points their timetable km, equal to the stop km at the stops', () => {
    expect(pointOf('ST').km).toBeCloseTo(263.6, 6);
    expect(pointOf('NDLS').km).toBeCloseTo(1388.4, 6);
  });

  it('has no track when the timetable shares fewer than two stations with the route', () => {
    const lone = STOPS.slice(0, 1);
    expect(buildTrack(ROUTE_12951, lone, new Map())).toBeNull();
  });
});

describe('pointAt with a timetable km', () => {
  it.each(STOPS.map((stop) => [stop.stationCode, stop.km] as const))(
    'sits on the station at the %s anchor',
    (code, km) => {
      const spot = pointAt(track, alongKmOf(track, km));
      const station = pointOf(code);
      expect(spot.lon).toBeCloseTo(station.lon, 4);
      expect(spot.lat).toBeCloseTo(station.lat, 4);
    },
  );

  it('places a km halfway between two stops halfway along the route between them', () => {
    const from = pointOf('BVI').alongKm;
    const to = pointOf('ST').alongKm;
    const along = alongKmOf(track, (30 + 263.6) / 2);
    expect(along).toBeCloseTo((from + to) / 2, 6);
    const spot = pointAt(track, along);
    expect(spot.index).toBeGreaterThanOrEqual(track.points.findIndex((p) => p.code === 'BVI'));
    expect(spot.index).toBeLessThan(track.points.findIndex((p) => p.code === 'ST'));
  });

  it('keeps a quarter of the way between stops at a quarter of the route between them', () => {
    const from = pointOf('KOTA').alongKm;
    const to = pointOf('NDLS').alongKm;
    const km = 922.8 + (1388.4 - 922.8) / 4;
    expect(alongKmOf(track, km)).toBeCloseTo(from + (to - from) / 4, 6);
  });

  it('holds at the ends for a km outside the timetable', () => {
    expect(alongKmOf(track, -5)).toBe(0);
    expect(alongKmOf(track, 2000)).toBeCloseTo(totalAlongKm(track), 6);
  });
});

describe('cutBetween', () => {
  it('starts and ends exactly at the two distances', () => {
    const from = alongKmOf(track, 500);
    const to = alongKmOf(track, 540);
    const cut = cutBetween(track, from, to);
    const start = pointAt(track, from);
    const end = pointAt(track, to);
    expect(cut[0]).toEqual(start);
    expect(cut.at(-1)).toEqual(end);
  });

  it('holds every route point between the two distances and no others', () => {
    const from = alongKmOf(track, 450);
    const to = alongKmOf(track, 640);
    const inside = track.points.filter((point) => point.alongKm > from && point.alongKm < to);
    const cut = cutBetween(track, from, to);
    expect(inside.length).toBeGreaterThan(0);
    expect(cut).toHaveLength(inside.length + 2);
    expect(cut.slice(1, -1).map((place) => place.lon)).toEqual(inside.map((point) => point.lon));
  });

  it('is just its two ends inside one stretch of track', () => {
    const from = pointOf('BCT').alongKm + 0.1;
    const cut = cutBetween(track, from, from + 0.2);
    expect(cut).toHaveLength(2);
  });
});

describe('headingAt', () => {
  it('runs roughly north-north-east out of Mumbai Central', () => {
    const heading = headingAt(track, 2);
    expect(heading).toBeGreaterThan(0);
    expect(heading).toBeLessThan(45);
  });
});

describe('nextIndex', () => {
  it('is the second point at the start, never the first', () => {
    expect(nextIndex(track, 0)).toBe(1);
  });

  it('is the point just ahead of the train', () => {
    const bvi = pointOf('BVI');
    const index = nextIndex(track, bvi.alongKm + 0.1);
    expect(track.points[index - 1]?.alongKm).toBeLessThanOrEqual(bvi.alongKm + 0.1);
    expect(track.points[index]?.alongKm).toBeGreaterThan(bvi.alongKm + 0.1);
  });

  it('is the last point past the end of the route', () => {
    expect(nextIndex(track, totalAlongKm(track) + 10)).toBe(track.points.length - 1);
  });
});

describe('renderScale', () => {
  it('draws true size when zoomed right in', () => {
    expect(renderScale(20, 20)).toEqual({ width: 1, length: 1, height: 1.2 });
  });

  it('caps the stretch when zoomed far out', () => {
    const scale = renderScale(20, 5);
    expect(scale.width).toBe(14);
    expect(scale.length).toBe(6);
  });
});

describe('trainFeatures', () => {
  const noseKm = alongKmOf(track, 500);

  it('draws the rake as one block when zoomed out', () => {
    expect(trainFeatures(track, noseKm, 10.8, renderScale(22, 10.8), 1).features).toHaveLength(1);
  });

  it('draws loco and coaches without window bays at mid zoom', () => {
    const scale = renderScale(22, 12);
    expect(trainFeatures(track, noseKm, 12, scale, 1).features).toHaveLength(4 + 6 + 21 * 9);
  });

  it('adds cab, pantograph and lit window bays up close', () => {
    const scale = renderScale(22, 15);
    expect(trainFeatures(track, noseKm, 15, scale, 0).features).toHaveLength(
      4 + 6 + 2 + 21 * (9 + 11),
    );
  });

  it('draws only the part of the rake that fits on the route at the start', () => {
    const scale = renderScale(19, 15);
    const short = trainFeatures(track, 0.2, 15, scale, 1).features.length;
    expect(short).toBeLessThan(432);
  });
});
