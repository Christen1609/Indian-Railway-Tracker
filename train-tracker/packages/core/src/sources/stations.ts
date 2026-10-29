// Features: station code aliases, halt matching

const HALT_RADIUS_KM = 2;
const EARTH_RADIUS_KM = 6371;
const DEGREES_PER_HALF_TURN = 180;
const ONE_STEP = 1;

/** A source's station code where it differs from the reference data */
const STATION_ALIASES: Record<string, string> = { MMCT: 'BCT', NKOT: 'DKNT' };

export type HaltPlace = { haltOrder: number; lat?: number; lon?: number };

export type OurHalt = { code: string; lat: number | null; lon: number | null };

export type HaltNeighbours = { prev: string | null; next: string | null };

/** Canonical station code for a source's one */
export function canonicalStationCode(code: string): string {
  return STATION_ALIASES[code] ?? code;
}

/** Straight-line kilometres between two points on the earth */
function distanceKm(from: { lat: number; lon: number }, to: { lat: number; lon: number }): number {
  const radians = (degrees: number): number => (degrees * Math.PI) / DEGREES_PER_HALF_TURN;
  const dLat = radians(to.lat - from.lat);
  const dLon = radians(to.lon - from.lon);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/** Our halt a source's unknown halt row stands for, or null when we cannot tell */
export function matchHalt(
  place: HaltPlace,
  halts: readonly OurHalt[],
  neighbours: HaltNeighbours,
): string | null {
  const ours = halts[place.haltOrder];
  if (ours === undefined) {
    return null;
  }
  if (place.lat !== undefined && place.lon !== undefined) {
    const isNear =
      ours.lat !== null &&
      ours.lon !== null &&
      distanceKm({ lat: place.lat, lon: place.lon }, { lat: ours.lat, lon: ours.lon }) <=
        HALT_RADIUS_KM;
    return isNear ? ours.code : null;
  }
  const before = halts[place.haltOrder - ONE_STEP]?.code;
  const after = halts[place.haltOrder + ONE_STEP]?.code;
  const isBetween =
    before !== undefined &&
    after !== undefined &&
    before === neighbours.prev &&
    after === neighbours.next;
  return isBetween ? ours.code : null;
}
