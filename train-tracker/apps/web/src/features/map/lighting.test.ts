import { describe, expect, it } from 'vitest';
import { daylightOf, isDarkPanels, mixHex, smoothStep, sunAt, sunPhase } from './lighting';

const DELHI = { lon: 77.22, lat: 28.64 };

describe('sunAt', () => {
  it('is high in the south at midday in Delhi in late October', () => {
    const sun = sunAt('2026-10-27T06:30:00.000Z', DELHI.lon, DELHI.lat);
    expect(sun.alt).toBeGreaterThan(45);
    expect(sun.alt).toBeLessThan(60);
    expect(sun.az).toBeGreaterThan(150);
    expect(sun.az).toBeLessThan(210);
  });

  it('is below the horizon at midnight in Delhi', () => {
    expect(sunAt('2026-10-27T18:30:00.000Z', DELHI.lon, DELHI.lat).alt).toBeLessThan(-30);
  });

  it('rises in the east in the morning', () => {
    const sun = sunAt('2026-10-27T01:30:00.000Z', DELHI.lon, DELHI.lat);
    expect(sun.alt).toBeGreaterThan(0);
    expect(sun.az).toBeGreaterThan(60);
    expect(sun.az).toBeLessThan(130);
  });
});

describe('sunPhase and panels', () => {
  it.each([
    ['deep night', -30, 'Night', true],
    ['twilight', -6, 'Twilight', true],
    ['just above the horizon', 2, 'Day', false],
    ['noon', 55, 'Day', false],
  ])('%s', (_name, alt, phase, isDark) => {
    expect(sunPhase({ alt, az: 100 })).toBe(phase);
    expect(isDarkPanels({ alt, az: 100 })).toBe(isDark);
  });
});

describe('daylightOf and smoothStep', () => {
  it('runs from 0 at night to 1 in full day', () => {
    expect(daylightOf({ alt: -30, az: 0 })).toBe(0);
    expect(daylightOf({ alt: 40, az: 0 })).toBe(1);
    expect(smoothStep(0, 10, 5)).toBe(0.5);
  });
});

describe('mixHex', () => {
  it('blends two colours by a fraction', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});
