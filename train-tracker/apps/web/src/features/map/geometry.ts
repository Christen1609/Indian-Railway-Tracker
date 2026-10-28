// Features: track from timetable stops, distance, position and heading, rake, shadow and lamps

import { assert } from '@train-tracker/core/types';
import type { Station, TimetableStop } from '@train-tracker/core/types';
import { mixHex } from './lighting';
import type { Sun } from './lighting';
import { HINDI_NAMES, MAJOR_CODES } from './route-12951';
import type { RoutePoint } from './route-12951';

export type Coord = { lon: number; lat: number };
export type TrackPoint = Coord & {
  code: string;
  name: string;
  nameHi: string;
  isStop: boolean;
  isMajor: boolean;
  alongKm: number;
  km: number;
};
type Anchor = { km: number; alongKm: number };
export type Track = { points: TrackPoint[]; anchors: Anchor[] };
export type Spot = Coord & { bearing: number; index: number };
export type RenderScale = { width: number; length: number; height: number };

type LngLat = [number, number];
type Properties = Record<string, string | number>;
type Geometry =
  | { type: 'Polygon'; coordinates: LngLat[][] }
  | { type: 'Point'; coordinates: LngLat }
  | { type: 'LineString'; coordinates: LngLat[] };
type Feature = { type: 'Feature'; properties: Properties; geometry: Geometry };
export type FeatureCollection = { type: 'FeatureCollection'; features: Feature[] };

type LiveryPart = keyof typeof LIVERY;
type Slab = [halfWidthM: number, baseM: number, topM: number, part: LiveryPart];
type Piece = { front: Coord; back: Coord; acrossEast: number; acrossNorth: number };

const RAD = Math.PI / 180;
const EARTH_DIAMETER_KM = 12742;
const METRES_PER_DEG_LAT = 110574;
const METRES_PER_DEG_LON_AT_EQUATOR = 111320;
const MIN_SPAN_KM = 1e-6;
const NEXT_MARGIN_KM = 0.02;
const HEADING_BACK_KM = 0.3;
const HEADING_FORWARD_KM = 0.9;
const MAP_METRES_PER_PIXEL_AT_ZOOM_0 = 78271.517;
const MAX_WIDTH_SCALE = 14;
const MAX_LENGTH_SCALE = 6;
const WIDTH_PER_PIXEL = 4.6;
const LENGTH_PER_PIXEL = 1.9;
const HEIGHT_OVER_WIDTH = 1.2;
const FAR_RAKE_BELOW_ZOOM = 11.6;
const DETAIL_FROM_ZOOM = 13;

export const LIVERY = {
  under: '#1b1114',
  skirt: '#6d1821',
  body: '#a3202b',
  band: '#efe6cf',
  glass: '#2b3240',
  lit: '#ffd27a',
  roof: '#59212a',
  loco: '#b0242f',
  locoroof: '#3b4048',
  panto: '#8d919a',
};
const LOCO_LEN_M = 20.6;
const COACH_LEN_M = 23.5;
const GAP_M = 1.1;
const COACHES = 21;
const NOSE_M = 2.6;
const RAKE_M = LOCO_LEN_M + COACHES * (COACH_LEN_M + GAP_M);
const WINDOW_BAYS = 11;
const WINDOW_PAD_M = 1.8;
const WINDOW_PITCH_M = 1.8;
const WINDOW_LEN_M = 1.2;
const NOSE_SLABS: Slab[] = [
  [1.16, 0.25, 1, 'under'],
  [1.3, 1, 1.42, 'skirt'],
  [1.36, 1.42, 3.26, 'loco'],
  [1.22, 3.26, 3.52, 'locoroof'],
];
const LOCO_SLABS: Slab[] = [
  [1.2, 0.25, 1, 'under'],
  [1.42, 1, 1.4, 'skirt'],
  [1.5, 1.4, 2.42, 'loco'],
  [1.5, 2.42, 2.66, 'band'],
  [1.5, 2.66, 3.56, 'loco'],
  [1.34, 3.56, 4, 'locoroof'],
];
const CAB_SLABS: Slab[] = [[1.4, 2.55, 3.18, 'glass']];
const PANTO_SLABS: Slab[] = [[0.86, 4, 5.35, 'panto']];
const COACH_SLABS: Slab[] = [
  [1.28, 0.25, 1.05, 'under'],
  [1.5, 1.05, 1.42, 'skirt'],
  [1.62, 1.42, 2.4, 'body'],
  [1.66, 2.4, 2.54, 'band'],
  [1.62, 2.54, 3.4, 'body'],
  [1.66, 3.4, 3.54, 'band'],
  [1.62, 3.54, 3.76, 'body'],
  [1.46, 3.76, 4.04, 'roof'],
  [1.14, 4.04, 4.14, 'roof'],
];
const WINDOW_SLABS: Slab[] = [[1.86, 2.62, 3.32, 'glass']];
const FAR_SLABS: Slab[] = [[1.6, 0, 4.1, 'body']];
const LAMP_POOL: [distanceKm: number, radius: number][] = [
  [0.012, 1],
  [0.026, 2],
  [0.044, 3],
  [0.066, 4],
  [0.094, 5],
  [0.128, 6],
];
const NOSE_LAMP_KM = 0.004;
const MIN_SHADOW_DROP_M = 5;
const MAX_SHADOW_DROP_M = 26;
const SHADOW_FULL_ALT = 60;
const SHADOW_HALF_WIDTH_M = 2;

/** Great-circle distance in km between two places */
export function haversineKm(a: Coord, b: Coord): number {
  const lat1 = a.lat * RAD;
  const lat2 = b.lat * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h =
    Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return EARTH_DIAMETER_KM * Math.asin(Math.sqrt(h));
}

/** Distance in km from the first place to each place along the line */
export function cumulativeKm(places: Coord[]): number[] {
  const totals: number[] = [];
  places.forEach((place, i) => {
    const before = places[i - 1];
    totals.push(before === undefined ? 0 : (totals[i - 1] ?? 0) + haversineKm(before, place));
  });
  return totals;
}

/** Compass bearing in degrees from one place to another */
export function bearingDeg(from: Coord, to: Coord): number {
  const east = (to.lon - from.lon) * Math.cos(from.lat * RAD);
  const north = to.lat - from.lat;
  return (Math.atan2(east, north) / RAD + 360) % 360;
}

/** The item at an index, which must exist */
function itemAt<T>(items: T[], index: number): T {
  const item = items[index];
  assert(item !== undefined, `an item at index ${index}`);
  return item;
}

/** Index of the last item at or before the target, kept inside the list's last span */
function segmentIndex<T>(items: T[], keyOf: (item: T) => number, target: number): number {
  let low = 0;
  let high = items.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (keyOf(itemAt(items, middle)) <= target) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return low;
}

/** A value on one anchor scale placed on the other, in proportion between the two anchors around it */
function convert(anchors: Anchor[], from: keyof Anchor, to: keyof Anchor, value: number): number {
  const index = segmentIndex(anchors, (anchor) => anchor[from], value);
  const start = itemAt(anchors, index);
  const end = itemAt(anchors, index + 1);
  const span = Math.max(end[from] - start[from], MIN_SPAN_KM);
  const fraction = Math.min(1, Math.max(0, (value - start[from]) / span));
  return start[to] + (end[to] - start[to]) * fraction;
}

/** The route as a track, with each timetable stop anchored to its station on the route */
export function buildTrack(
  route: RoutePoint[],
  stops: TimetableStop[],
  stations: Map<string, Station>,
): Track | null {
  const alongKms = cumulativeKm(route); // distance along the route to each point, from cumulativeKm
  const anchors = stops.flatMap((stop) => {
    const index = route.findIndex((point) => point.code === stop.stationCode);
    return index === -1 ? [] : [{ km: stop.km, alongKm: itemAt(alongKms, index) }];
  });
  if (anchors.length < 2) {
    return null;
  }
  const stopCodes = new Set(stops.map((stop) => stop.stationCode));
  const points = route.map((point, i) => {
    const station = stations.get(point.code);
    const alongKm = itemAt(alongKms, i);
    return {
      ...point,
      name: station?.name ?? point.name,
      nameHi: station?.nameHi ?? HINDI_NAMES[point.code] ?? '',
      isStop: stopCodes.has(point.code),
      isMajor: MAJOR_CODES.has(point.code),
      alongKm,
      km: convert(anchors, 'alongKm', 'km', alongKm),
    };
  });
  return { points, anchors };
}

/** Timetable km as distance along the drawn route */
export function alongKmOf(track: Track, km: number): number {
  return convert(track.anchors, 'km', 'alongKm', km);
}

/** Length of the drawn route in km */
export function totalAlongKm(track: Track): number {
  return itemAt(track.points, track.points.length - 1).alongKm;
}

/** Position and bearing at a distance along the route */
export function pointAt(track: Track, alongKm: number): Spot {
  const clamped = Math.min(totalAlongKm(track), Math.max(0, alongKm));
  const index = segmentIndex(track.points, (point) => point.alongKm, clamped);
  const start = itemAt(track.points, index);
  const end = itemAt(track.points, index + 1);
  const fraction = (clamped - start.alongKm) / Math.max(end.alongKm - start.alongKm, MIN_SPAN_KM);
  return {
    lon: start.lon + (end.lon - start.lon) * fraction,
    lat: start.lat + (end.lat - start.lat) * fraction,
    bearing: bearingDeg(start, end),
    index,
  };
}

/** Bearing of the route around the train */
export function headingAt(track: Track, alongKm: number): number {
  return bearingDeg(
    pointAt(track, alongKm - HEADING_BACK_KM), // spot just behind the train, from pointAt
    pointAt(track, alongKm + HEADING_FORWARD_KM), // spot just ahead of the train, from pointAt
  );
}

/** Index of the first route point ahead of a distance along the route */
export function nextIndex(track: Track, alongKm: number): number {
  const found = track.points.findIndex((point) => point.alongKm > alongKm + NEXT_MARGIN_KM);
  return found === -1 ? track.points.length - 1 : Math.max(1, found);
}

/** Route points between two distances along the route, with exact ends */
export function cutBetween(track: Track, fromAlongKm: number, toAlongKm: number): Coord[] {
  const start = pointAt(track, fromAlongKm); // spot at the start, from pointAt
  const end = pointAt(track, toAlongKm); // spot at the end, from pointAt
  return [start, ...track.points.slice(start.index + 1, end.index + 1), end];
}

/** A place shifted east and north by metres */
function shift(place: Coord, eastM: number, northM: number): Coord {
  return {
    lon: place.lon + eastM / (METRES_PER_DEG_LON_AT_EQUATOR * Math.cos(place.lat * RAD)),
    lat: place.lat + northM / METRES_PER_DEG_LAT,
  };
}

/** GeoJSON position for a place */
function lngLatOf(place: Coord): LngLat {
  return [place.lon, place.lat];
}

/** GeoJSON line through places */
export function lineCollection(places: Coord[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: places.map(lngLatOf) },
      },
    ],
  };
}

/** GeoJSON points with properties */
export function pointCollection(
  points: { at: Coord; properties?: Properties }[],
): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points.map(({ at, properties }) => ({
      type: 'Feature',
      properties: properties ?? {},
      geometry: { type: 'Point', coordinates: lngLatOf(at) },
    })),
  };
}

/** How much the rake is drawn over real size at a zoom, so it stays readable when zoomed out */
export function renderScale(lat: number, zoom: number): RenderScale {
  const metresPerPixel = (MAP_METRES_PER_PIXEL_AT_ZOOM_0 * Math.cos(lat * RAD)) / 2 ** zoom;
  const width = Math.min(MAX_WIDTH_SCALE, Math.max(1, metresPerPixel * WIDTH_PER_PIXEL));
  const length = Math.min(MAX_LENGTH_SCALE, Math.max(1, metresPerPixel * LENGTH_PER_PIXEL));
  return { width, length, height: width * HEIGHT_OVER_WIDTH };
}

/** One stretch of the rake, in metres behind the nose, with its across-track direction */
function pieceBetween(
  track: Track,
  noseKm: number,
  fromM: number,
  toM: number,
  scale: RenderScale,
): Piece | null {
  const backKm = noseKm - (toM * scale.length) / 1000;
  if (backKm < 0) {
    return null;
  }
  const front = pointAt(track, noseKm - (fromM * scale.length) / 1000); // spot at the front, from pointAt
  const back = pointAt(track, backKm); // spot at the back, from pointAt
  const east = (front.lon - back.lon) * METRES_PER_DEG_LON_AT_EQUATOR * Math.cos(front.lat * RAD);
  const north = (front.lat - back.lat) * METRES_PER_DEG_LAT;
  const length = Math.hypot(east, north) || 1;
  return { front, back, acrossEast: -north / length, acrossNorth: east / length };
}

/** Slabs of one piece added to the feature list */
function addSlabs(
  features: Feature[],
  piece: Piece | null,
  slabs: Slab[],
  scale: RenderScale,
  colors: Record<LiveryPart, string>,
): void {
  if (piece === null) {
    return;
  }
  for (const [halfWidthM, baseM, topM, part] of slabs) {
    const east = piece.acrossEast * halfWidthM * scale.width;
    const north = piece.acrossNorth * halfWidthM * scale.width;
    const corner = lngLatOf(shift(piece.front, east, north));
    features.push({
      type: 'Feature',
      properties: { base: baseM * scale.height, top: topM * scale.height, color: colors[part] },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            corner,
            lngLatOf(shift(piece.front, -east, -north)),
            lngLatOf(shift(piece.back, -east, -north)),
            lngLatOf(shift(piece.back, east, north)),
            corner,
          ],
        ],
      },
    });
  }
}

/** The rake as extruded boxes: loco, pantograph, coaches, lit window bays */
export function trainFeatures(
  track: Track,
  noseKm: number,
  zoom: number,
  scale: RenderScale,
  daylight: number,
): FeatureCollection {
  const colors = { ...LIVERY, glass: mixHex(LIVERY.glass, LIVERY.lit, 1 - daylight) };
  const features: Feature[] = [];
  const add = (fromM: number, toM: number, slabs: Slab[]) =>
    addSlabs(features, pieceBetween(track, noseKm, fromM, toM, scale), slabs, scale, colors);
  if (zoom < FAR_RAKE_BELOW_ZOOM) {
    add(0, RAKE_M, FAR_SLABS);
    return { type: 'FeatureCollection', features };
  }
  const hasDetail = zoom >= DETAIL_FROM_ZOOM;
  add(0, NOSE_M, NOSE_SLABS);
  add(NOSE_M, LOCO_LEN_M, LOCO_SLABS);
  if (hasDetail) {
    add(0.9, 2.3, CAB_SLABS);
    add(6.4, 7.6, PANTO_SLABS);
  }
  for (let coach = 0; coach < COACHES; coach++) {
    const frontM = LOCO_LEN_M + GAP_M + coach * (COACH_LEN_M + GAP_M);
    const coachPiece = pieceBetween(track, noseKm, frontM, frontM + COACH_LEN_M, scale); // coach stretch, from pieceBetween
    if (coachPiece === null) {
      break;
    }
    addSlabs(features, coachPiece, COACH_SLABS, scale, colors);
    if (hasDetail) {
      for (let bay = 0; bay < WINDOW_BAYS; bay++) {
        const windowM = frontM + WINDOW_PAD_M + bay * WINDOW_PITCH_M;
        add(windowM, windowM + WINDOW_LEN_M, WINDOW_SLABS);
      }
    }
  }
  return { type: 'FeatureCollection', features };
}

/** The rake's shadow on the ground, thrown away from the sun */
export function shadowFeatures(
  track: Track,
  noseKm: number,
  scale: RenderScale,
  sun: Sun,
): FeatureCollection {
  const centre = cutBetween(track, Math.max(0, noseKm - (RAKE_M * scale.length) / 1000), noseKm); // route under the rake, from cutBetween
  const throwDeg = (sun.az + 180) % 360;
  const dropM = Math.max(
    MIN_SHADOW_DROP_M,
    MAX_SHADOW_DROP_M * (1 - Math.min(SHADOW_FULL_ALT, Math.max(0, sun.alt)) / SHADOW_FULL_ALT),
  );
  const dropEast = dropM * Math.sin(throwDeg * RAD);
  const dropNorth = dropM * Math.cos(throwDeg * RAD);
  const halfWidthM = SHADOW_HALF_WIDTH_M * scale.width;
  const left: Coord[] = [];
  const right: Coord[] = [];
  centre.forEach((place, i) => {
    const before = itemAt(centre, Math.max(0, i - 1));
    const after = itemAt(centre, Math.min(centre.length - 1, i + 1));
    const across = (bearingDeg(before, after) + 90) * RAD;
    const base = shift(place, dropEast, dropNorth);
    left.push(shift(base, Math.sin(across) * halfWidthM, Math.cos(across) * halfWidthM));
    right.push(shift(base, -Math.sin(across) * halfWidthM, -Math.cos(across) * halfWidthM));
  });
  const ring = [...left, ...right.reverse(), itemAt(left, 0)].map(lngLatOf);
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } },
    ],
  };
}

/** Headlight pool ahead, marker lamp on the nose, tail lamp at the back */
export function lampFeatures(track: Track, noseKm: number, scale: RenderScale): FeatureCollection {
  const pool = LAMP_POOL.map(([distanceKm, radius]) => ({
    at: pointAt(track, noseKm + distanceKm), // spot ahead of the nose, from pointAt
    properties: { radius, kind: 0 },
  }));
  return pointCollection([
    ...pool,
    { at: pointAt(track, noseKm + NOSE_LAMP_KM), properties: { radius: 0, kind: 1 } },
    {
      at: pointAt(track, Math.max(0, noseKm - (RAKE_M * scale.length) / 1000)),
      properties: { radius: 0, kind: 2 },
    },
  ]);
}
