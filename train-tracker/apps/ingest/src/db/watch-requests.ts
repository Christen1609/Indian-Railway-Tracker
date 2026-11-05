// Features: the requests the website made, answering a request, saving a fetched timetable

import { z } from 'zod';
import type { TimetableHaltRead } from '@train-tracker/core/sources/goibibo';
import type { IsoUtc } from '@train-tracker/core/types';
import { stationPointsFor } from './journey-data.js';
import { deleteRows, patchRows, readRows, writeRows } from './rest.js';
import type { DbConfig } from './rest.js';

const TrainRows = z.array(z.object({ train_number: z.string().min(1) }));

export type RequestStatus = 'ready' | 'failed';

/** The trains whose timetable is still waiting to be fetched, oldest request first */
export async function pendingRequests(config: DbConfig): Promise<string[]> {
  const query =
    'watch_requests?timetable_status=eq.pending&select=train_number&order=requested_at.asc';
  return TrainRows.parse(await readRows(query, config)).map((row) => row.train_number); // rows, from readRows
}

/** The trains requested since a time whose timetable is ready, newest request first, up to a limit */
export async function requestedSince(
  since: IsoUtc,
  limit: number,
  config: DbConfig,
): Promise<string[]> {
  const query = `watch_requests?timetable_status=eq.ready&requested_at=gte.${encodeURIComponent(since)}&select=train_number&order=requested_at.desc&limit=${limit}`;
  return TrainRows.parse(await readRows(query, config)).map((row) => row.train_number); // rows, from readRows
}

/** Answers a request: ready, or failed with a short reason */
export async function answerRequest(
  trainNumber: string,
  status: RequestStatus,
  error: string | null,
  now: IsoUtc,
  config: DbConfig,
): Promise<void> {
  await patchRows(
    `watch_requests?train_number=eq.${trainNumber}`,
    { timetable_status: status, timetable_error: error, updated_at: now },
    config,
  );
}

/** Adds the stations we do not hold yet and leaves the ones we do untouched */
async function addMissingStations(
  halts: readonly TimetableHaltRead[],
  config: DbConfig,
): Promise<void> {
  const codes = [...new Set(halts.map((halt) => halt.stationCode))];
  const held = await stationPointsFor(codes, config); // the stations we hold, from stationPointsFor
  const missing = new Map(
    halts.filter((halt) => !held.has(halt.stationCode)).map((halt) => [halt.stationCode, halt]),
  );
  if (missing.size === 0) {
    return;
  }
  await writeRows(
    'stations?select=code',
    [...missing.values()].map((halt) => ({
      code: halt.stationCode,
      name: halt.name,
      lat: halt.lat,
      lon: halt.lon,
    })),
    config,
  );
}

/** Replaces a train's timetable with the halts just read, adding missing stations first and the run days when known */
export async function saveTimetable(
  trainNumber: string,
  halts: readonly TimetableHaltRead[],
  runsOn: number | null,
  config: DbConfig,
): Promise<void> {
  await addMissingStations(halts, config);
  await deleteRows(`timetable_stops?train_number=eq.${trainNumber}`, config);
  await writeRows(
    'timetable_stops?select=seq',
    halts.map((halt) => ({
      train_number: trainNumber,
      seq: halt.seq,
      station_code: halt.stationCode,
      sched_arr: halt.schedArrMin,
      sched_dep: halt.schedDepMin,
      km: halt.km,
    })),
    config,
  );
  if (runsOn !== null) {
    await patchRows(`trains?number=eq.${trainNumber}`, { runs_on: runsOn }, config);
  }
}
