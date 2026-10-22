// Features: environment, batched upsert, the load run

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cached, stationRows, trainRows } from './datameet.ts';
import { STOPS_12951, TRAIN_12951 } from './seed-12951.ts';
import type { StationRow, TimetableStopRow, TrainRow } from './rows.ts';

const BATCH = 1000;
const CACHE = join(dirname(fileURLToPath(import.meta.url)), '..', '.cache');

/** Reads a required environment variable */
function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

/** Upserts rows into one table in batches, returning how many were sent */
async function upsert(
  table: string,
  rows: readonly (StationRow | TrainRow | TimetableStopRow)[],
): Promise<number> {
  const url = env('SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  let sent = 0;
  for (let start = 0; start < rows.length; start += BATCH) {
    const batch = rows.slice(start, start + BATCH);
    const res = await fetch(`${url}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      throw new Error(`Upsert into ${table} failed. Status ${res.status}. ${await res.text()}`);
    }
    sent += batch.length;
  }
  return sent;
}

/** Loads stations, trains and the 12951 timetable into Supabase */
async function main(): Promise<void> {
  const stations = stationRows(await cached(CACHE, 'stations.json'));
  // Output of stationRows: validated rows, plus how many features were unusable
  console.log(`stations parsed ${stations.rows.length}, skipped ${stations.skipped}`);

  const known = new Set(stations.rows.map((row) => row.code));
  const trains = trainRows(await cached(CACHE, 'trains.json'), known);
  // Output of trainRows: rows whose origin and destination both exist in stations
  console.log(`trains parsed ${trains.rows.length}, skipped ${trains.skipped}`);

  const withSpeed = trains.rows.map((row) =>
    row.number === TRAIN_12951.number
      ? { ...row, runs_on: TRAIN_12951.runs_on, top_speed_kmh: TRAIN_12951.top_speed_kmh }
      : row,
  );

  console.log(`stations upserted ${await upsert('stations', stations.rows)}`);
  console.log(`trains upserted ${await upsert('trains', withSpeed)}`);
  console.log(`timetable_stops upserted ${await upsert('timetable_stops', STOPS_12951)}`);
}

await main();
