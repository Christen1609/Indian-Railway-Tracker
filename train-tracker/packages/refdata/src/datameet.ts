// Features: download and cache, station rows, train rows

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { StationRow, TrainRow } from './rows.ts';

const BASE = 'https://raw.githubusercontent.com/datameet/railways/master';

const stationFeature = z.object({
  properties: z.object({
    code: z.string().min(1),
    name: z.string().min(1),
    zone: z.string().nullable().optional(),
  }),
  geometry: z
    .object({
      type: z.literal('Point'),
      coordinates: z.tuple([z.number(), z.number()]),
    })
    .nullable(),
});

const trainFeature = z.object({
  properties: z.object({
    number: z.string().min(1),
    name: z.string().min(1),
    from_station_code: z.string().min(1),
    to_station_code: z.string().min(1),
  }),
});

const collection = z.object({ features: z.array(z.unknown()) });

/** Reads a datameet file from the cache directory, downloading it once */
export async function cached(dir: string, name: string): Promise<unknown> {
  const path = join(dir, name);
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    const res = await fetch(`${BASE}/${name}`);
    if (!res.ok) {
      throw new Error(`Download failed for ${name}. Status ${res.status}`);
    }
    const body = await res.text();
    await mkdir(dir, { recursive: true });
    await writeFile(path, body, 'utf8');
    return JSON.parse(body);
  }
}

/** Turns stations.json into station rows, dropping any feature that fails validation */
export function stationRows(raw: unknown): { rows: StationRow[]; skipped: number } {
  const parsed = collection.parse(raw);
  const rows: StationRow[] = [];
  let skipped = 0;
  for (const feature of parsed.features) {
    const result = stationFeature.safeParse(feature);
    if (!result.success) {
      skipped += 1;
      continue;
    }
    const { properties, geometry } = result.data;
    rows.push({
      code: properties.code,
      name: properties.name,
      name_hi: null,
      lat: geometry === null ? null : geometry.coordinates[1],
      lon: geometry === null ? null : geometry.coordinates[0],
      zone: properties.zone ?? null,
    });
  }
  return { rows, skipped };
}

/** Turns trains.json into train rows, keeping only those whose endpoints are known stations */
export function trainRows(
  raw: unknown,
  known: ReadonlySet<string>,
): { rows: TrainRow[]; skipped: number } {
  const parsed = collection.parse(raw);
  const rows: TrainRow[] = [];
  let skipped = 0;
  for (const feature of parsed.features) {
    const result = trainFeature.safeParse(feature);
    if (!result.success) {
      skipped += 1;
      continue;
    }
    const p = result.data.properties;
    if (!known.has(p.from_station_code) || !known.has(p.to_station_code)) {
      skipped += 1;
      continue;
    }
    rows.push({
      number: p.number,
      name: p.name,
      origin: p.from_station_code,
      destination: p.to_station_code,
      runs_on: null,
      top_speed_kmh: null,
    });
  }
  return { rows, skipped };
}
