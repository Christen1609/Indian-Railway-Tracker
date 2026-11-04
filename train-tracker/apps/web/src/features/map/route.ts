// Features: route points for a train, from the detailed route or the timetable stops

import type { Station, TimetableStop } from '@train-tracker/core/types';
import { HINDI_NAMES, MAJOR_CODES, ROUTES } from './route-12951';
import type { RoutePoint } from './route-12951';

export type RouteDetail = { hindiNames: Record<string, string>; majorCodes: ReadonlySet<string> };
export type DrawnRoute = { points: RoutePoint[]; detail: RouteDetail };

export const NO_DETAIL: RouteDetail = { hindiNames: {}, majorCodes: new Set() };
export const DETAIL_12951: RouteDetail = { hindiNames: HINDI_NAMES, majorCodes: MAJOR_CODES };

/** Route points at the timetable stops in order, skipping stations without coordinates */
export function routeFromStops(
  stops: readonly TimetableStop[],
  stations: ReadonlyMap<string, Station>,
): RoutePoint[] {
  const seen = new Set<string>();
  return [...stops]
    .sort((a, b) => a.seq - b.seq)
    .flatMap((stop) => {
      const station = stations.get(stop.stationCode);
      if (
        station === undefined ||
        station.lat === null ||
        station.lon === null ||
        seen.has(station.code)
      ) {
        return [];
      }
      seen.add(station.code);
      return [{ code: station.code, name: station.name, lon: station.lon, lat: station.lat }];
    });
}

/** The detailed route when the train has one, else a route through its stops */
export function routeFor(
  trainNumber: string,
  stops: readonly TimetableStop[],
  stations: ReadonlyMap<string, Station>,
): DrawnRoute {
  const detailed = ROUTES[trainNumber];
  return detailed === undefined
    ? { points: routeFromStops(stops, stations), detail: NO_DETAIL }
    : { points: detailed, detail: DETAIL_12951 };
}
