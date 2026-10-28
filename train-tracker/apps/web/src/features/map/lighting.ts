// Features: sun position, day phase, colour mixing

import type { IsoUtc } from '@train-tracker/core/types';

export type Sun = { alt: number; az: number };

const RAD = Math.PI / 180;
const MS_PER_DAY = 864e5;
const J2000_DAY_OFFSET = 10957.5;
const FULL_DAYLIGHT_ALT = 6;
const NO_DAYLIGHT_ALT = -14;
const DAWN_GLOW_ALT = -2;
const DAWN_GLOW_SPREAD = 9;
const NIGHT_BELOW_ALT = -12;
const TWILIGHT_BELOW_ALT = -0.8;
const DARK_PANELS_BELOW_ALT = -4;

/** Sun altitude and azimuth in degrees at an instant and place */
export function sunAt(at: IsoUtc, lon: number, lat: number): Sun {
  const days = Date.parse(at) / MS_PER_DAY - J2000_DAY_OFFSET;
  const anomaly = (357.529 + 0.98560028 * days) * RAD;
  const meanLongitude = 280.459 + 0.98564736 * days;
  const eclipticLon =
    (meanLongitude + 1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)) * RAD;
  const tilt = (23.439 - 3.6e-7 * days) * RAD;
  const rightAscension = Math.atan2(Math.cos(tilt) * Math.sin(eclipticLon), Math.cos(eclipticLon));
  const declination = Math.asin(Math.sin(tilt) * Math.sin(eclipticLon));
  const hourAngle =
    (((18.697374558 + 24.06570982441908 * days) % 24) * 15 + lon) * RAD - rightAscension;
  const latRad = lat * RAD;
  const altitude = Math.asin(
    Math.sin(latRad) * Math.sin(declination) +
      Math.cos(latRad) * Math.cos(declination) * Math.cos(hourAngle),
  );
  const azimuth = Math.atan2(
    -Math.sin(hourAngle),
    Math.tan(declination) * Math.cos(latRad) - Math.sin(latRad) * Math.cos(hourAngle),
  );
  return { alt: altitude / RAD, az: (azimuth / RAD + 360) % 360 };
}

/** Eased 0 to 1 between two edges */
export function smoothStep(edge0: number, edge1: number, value: number): number {
  const x = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return x * x * (3 - 2 * x);
}

/** How day-like the light is, 0 at night to 1 in full day */
export function daylightOf(sun: Sun): number {
  return smoothStep(NO_DAYLIGHT_ALT, FULL_DAYLIGHT_ALT, sun.alt);
}

/** How strong the dawn or dusk glow is, 0 to 1 */
export function dawnGlowOf(sun: Sun): number {
  return Math.max(0, 1 - Math.abs(sun.alt - DAWN_GLOW_ALT) / DAWN_GLOW_SPREAD);
}

/** Night, Twilight or Day for the sun's altitude */
export function sunPhase(sun: Sun): 'Night' | 'Twilight' | 'Day' {
  if (sun.alt < NIGHT_BELOW_ALT) {
    return 'Night';
  }
  return sun.alt < TWILIGHT_BELOW_ALT ? 'Twilight' : 'Day';
}

/** Whether the panels should use their dark theme */
export function isDarkPanels(sun: Sun): boolean {
  return sun.alt < DARK_PANELS_BELOW_ALT;
}

/** Hex colour as red, green and blue */
export function hexToRgb(hex: string): number[] {
  return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
}

/** Hex colour blended from one to another by a fraction */
export function mixHex(from: string, to: string, fraction: number): string {
  const start = hexToRgb(from);
  const end = hexToRgb(to);
  const channels = start.map((value, i) => {
    const target = end[i] ?? value;
    return Math.round(value + (target - value) * fraction)
      .toString(16)
      .padStart(2, '0');
  });
  return `#${channels.join('')}`;
}
