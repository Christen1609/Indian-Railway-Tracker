// Features: row schemas and their mappers to core types

import { z } from 'zod';
import type {
  Journey,
  JourneyStatus,
  ResolvedEvent,
  Station,
  TimetableStop,
  Train,
  TrainState,
  TrainStateKind,
} from '@train-tracker/core/types';
import { toUtc } from '@train-tracker/core/time';

export type StopEvent = Pick<ResolvedEvent, 'stationCode' | 'type' | 'at'>;

const JOURNEY_STATUSES = [
  'scheduled',
  'running',
  'arrived',
  'cancelled',
] as const satisfies readonly JourneyStatus[];
const TRAIN_STATE_KINDS = [
  'scheduled',
  'running',
  'halted',
  'late',
  'arrived',
] as const satisfies readonly TrainStateKind[];

const Utc = z.string().transform((value, ctx) => {
  const utc = toUtc(value);
  if (utc === null) {
    ctx.issues.push({
      code: 'custom',
      message: `Expected a timestamp with an offset, got ${value}`,
      input: value,
    });
    return z.NEVER;
  }
  return utc;
});

export const StationRow = z
  .object({
    code: z.string().min(1),
    name: z.string().min(1),
    name_hi: z.string().nullable(),
    lat: z.number().nullable(),
    lon: z.number().nullable(),
    zone: z.string().nullable(),
  })
  .transform((row): Station => ({
    code: row.code,
    name: row.name,
    nameHi: row.name_hi,
    lat: row.lat,
    lon: row.lon,
    zone: row.zone,
  }));

export const TrainRow = z
  .object({
    number: z.string().min(1),
    name: z.string().min(1),
    origin: z.string().min(1),
    destination: z.string().min(1),
    runs_on: z.number().int().nullable(),
    top_speed_kmh: z.number().int().nullable(),
  })
  .transform((row): Train => ({
    number: row.number,
    name: row.name,
    origin: row.origin,
    destination: row.destination,
    runsOn: row.runs_on,
    topSpeedKmh: row.top_speed_kmh,
  }));

export const TimetableStopRow = z
  .object({
    train_number: z.string().min(1),
    seq: z.number().int(),
    station_code: z.string().min(1),
    sched_arr: z.number().int().nullable(),
    sched_dep: z.number().int().nullable(),
    km: z.number(),
  })
  .transform((row): TimetableStop => ({
    trainNumber: row.train_number,
    seq: row.seq,
    stationCode: row.station_code,
    schedArrMin: row.sched_arr,
    schedDepMin: row.sched_dep,
    km: row.km,
  }));

export const JourneyRow = z
  .object({
    id: z.string().min(1),
    train_number: z.string().min(1),
    journey_date: z.iso.date(),
    status: z.enum(JOURNEY_STATUSES),
    is_scored: z.boolean(),
  })
  .transform((row): Journey => ({
    id: row.id,
    trainNumber: row.train_number,
    journeyDate: row.journey_date,
    status: row.status,
    isScored: row.is_scored,
  }));

export const TrainStateRow = z
  .object({
    journey_id: z.string().min(1),
    state: z.enum(TRAIN_STATE_KINDS),
    km: z.number(),
    lo_km: z.number(),
    hi_km: z.number(),
    pace: z.number(),
    delay_min: z.number().int().nullable(),
    next_station: z.string().nullable(),
    window_start: Utc.nullable(),
    window_end: Utc.nullable(),
    next_check_at: Utc.nullable(),
    updated_at: Utc,
  })
  .transform((row): TrainState => ({
    journeyId: row.journey_id,
    state: row.state,
    km: row.km,
    loKm: row.lo_km,
    hiKm: row.hi_km,
    pace: row.pace,
    delayMin: row.delay_min,
    nextStation: row.next_station,
    window:
      row.window_start !== null && row.window_end !== null
        ? { windowStart: row.window_start, windowEnd: row.window_end }
        : null,
    nextCheckAt: row.next_check_at,
    updatedAt: row.updated_at,
  }));

export const StopEventRow = z
  .object({
    station_code: z.string().min(1),
    type: z.enum(['ARR', 'DEP', 'PASS']),
    at: Utc,
  })
  .transform((row): StopEvent => ({ stationCode: row.station_code, type: row.type, at: row.at }));
