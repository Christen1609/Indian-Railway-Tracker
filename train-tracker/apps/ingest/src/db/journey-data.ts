// Features: the journey row, the timetable, train facts, confirmed events, saving events and state

import { z } from 'zod';
import { assert } from '@train-tracker/core/types';
import type {
  Confidence,
  Estimate,
  EventType,
  IsoDate,
  IsoUtc,
  ResolvedEvent,
  SourceEvent,
  SourceId,
  TimetableStop,
  TrainState,
  TrainStateKind,
} from '@train-tracker/core/types';
import type { LoggedWindow, WindowHit } from '@train-tracker/core/accuracy/score';
import type { SectionCapSeen } from '@train-tracker/core/estimate';
import { istMonthStart } from '@train-tracker/core/time';
import { countRows, deleteRows, patchRows, readRows, writeRows } from './rest.js';
import type { DbConfig } from './rest.js';

const JourneyRows = z.array(z.object({ id: z.string().min(1), is_scored: z.boolean() }));

const StopRows = z.array(
  z.object({
    seq: z.number().int(),
    station_code: z.string().min(1),
    sched_arr: z.number().int().nullable(),
    sched_dep: z.number().int().nullable(),
    km: z.number(),
  }),
);

const TrainRows = z.array(z.object({ top_speed_kmh: z.number().int().nullable() }));

const CapRows = z.array(
  z.object({
    from_seq: z.number().int(),
    fastest_pace: z.number(),
    trips_seen: z.number().int(),
  }),
);

const ResolvedRows = z.array(
  z.object({
    station_code: z.string().min(1),
    type: z.string().min(1),
    at: z.string().min(1),
    confidence_score: z.number(),
    confidence: z.string().min(1),
    chosen_source: z.string().min(1),
    sources: z.array(z.string().min(1)),
    resolved_at: z.string().min(1),
  }),
);

const StateRows = z.array(
  z.object({ next_check_at: z.string().nullable(), updated_at: z.string().min(1) }),
);

const LoggedRows = z.array(
  z.object({
    at: z.string().min(1),
    window_start: z.string().min(1),
    window_end: z.string().min(1),
  }),
);

const UncleanedRows = z.array(
  z.object({
    id: z.string().min(1),
    train_number: z.string().min(1),
    journey_date: z.string().min(1),
  }),
);

export type JourneyRef = { id: string; isScored: boolean };

export type UncleanedJourney = { id: string; trainNumber: string; journeyDate: IsoDate };

export type StateMemory = { nextCheckAt: IsoUtc | null; updatedAt: IsoUtc };

/** The journey for one train on one date, started if this is the first we have seen of it */
export async function journeyFor(
  trainNumber: string,
  journeyDate: IsoDate,
  config: DbConfig,
): Promise<JourneyRef> {
  const query = `journeys?train_number=eq.${trainNumber}&journey_date=eq.${journeyDate}&select=id,is_scored`;
  const found = JourneyRows.parse(await readRows(query, config)); // rows, from readRows
  const held = found[0];
  if (held !== undefined) {
    return { id: held.id, isScored: held.is_scored };
  }

  const started = JourneyRows.parse(
    await writeRows(
      'journeys?select=id,is_scored',
      { train_number: trainNumber, journey_date: journeyDate, status: 'scheduled' },
      config,
    ),
  ); // rows, from writeRows
  const row = started[0];
  assert(row !== undefined, 'a journey row back from starting a journey');
  return { id: row.id, isScored: row.is_scored };
}

/** The journeys whose data has not been swept yet */
export async function uncleanedJourneys(config: DbConfig): Promise<UncleanedJourney[]> {
  const query =
    'journeys?cleaned_at=is.null&select=id,train_number,journey_date&order=journey_date.asc';
  const rows = UncleanedRows.parse(await readRows(query, config)); // rows, from readRows
  return rows.map((row) => ({
    id: row.id,
    trainNumber: row.train_number,
    journeyDate: row.journey_date,
  }));
}

/** Whether a journey has been graded, which is what guards its confirmed events */
export async function hasScores(journeyId: string, config: DbConfig): Promise<boolean> {
  const counted = await countRows(`window_hits?journey_id=eq.${journeyId}`, config); // the count, from countRows
  return counted > 0;
}

/** Deletes the raw responses of one journey, which scoring never needs */
export async function deleteRawFor(journeyId: string, config: DbConfig): Promise<void> {
  await deleteRows(`raw_fetches?journey_id=eq.${journeyId}`, config);
}

/** Deletes everything we worked out about one journey, once its scores are safe */
export async function deleteDerivedFor(journeyId: string, config: DbConfig): Promise<void> {
  for (const table of ['source_events', 'resolved_events', 'estimate_log', 'train_state']) {
    await deleteRows(`${table}?journey_id=eq.${journeyId}`, config);
  }
}

/** Marks a journey as arrived and swept, so the sweep never looks at it again */
export async function markCleaned(journeyId: string, at: IsoUtc, config: DbConfig): Promise<void> {
  await patchRows(`journeys?id=eq.${journeyId}`, { status: 'arrived', cleaned_at: at }, config);
}

/** Records the estimate we are showing now, so it can be graded once the train arrives */
export async function saveEstimate(
  journeyId: string,
  estimate: Estimate,
  at: IsoUtc,
  config: DbConfig,
): Promise<void> {
  await writeRows(
    'estimate_log?select=journey_id',
    {
      journey_id: journeyId,
      at,
      km: estimate.km,
      lo_km: estimate.loKm,
      hi_km: estimate.hiKm,
      next_station: estimate.nextStation,
      window_start: estimate.window?.windowStart ?? null,
      window_end: estimate.window?.windowEnd ?? null,
    },
    config,
    'journey_id,at',
  );
}

/** Every window we showed for one stop, oldest first */
export async function loggedWindowsFor(
  journeyId: string,
  stationCode: string,
  config: DbConfig,
): Promise<LoggedWindow[]> {
  const query = `estimate_log?journey_id=eq.${journeyId}&next_station=eq.${stationCode}&window_start=not.is.null&select=at,window_start,window_end&order=at.asc`;
  const rows = LoggedRows.parse(await readRows(query, config)); // rows, from readRows
  return rows.map((row) => ({
    at: row.at,
    windowStart: row.window_start,
    windowEnd: row.window_end,
  }));
}

/** Records how each window we showed compares with the arrival that followed */
export async function saveWindowHits(
  journeyId: string,
  hits: readonly WindowHit[],
  config: DbConfig,
): Promise<void> {
  if (hits.length === 0) {
    return;
  }
  await writeRows(
    'window_hits?select=journey_id',
    hits.map((one) => ({
      journey_id: journeyId,
      station_code: one.stationCode,
      published_at: one.publishedAt,
      arrived_at: one.arrivedAt,
      window_start: one.windowStart,
      window_end: one.windowEnd,
      hit: one.hit,
      width_min: one.widthMin,
      lead_min: one.leadMin,
    })),
    config,
    'journey_id,station_code,published_at',
  );
}

/** How many calls one source has cost since the IST month began */
export async function callsThisMonth(
  source: SourceId,
  now: IsoUtc,
  config: DbConfig,
): Promise<number> {
  const since = istMonthStart(now); // the start of the IST month, from istMonthStart
  return countRows(`raw_fetches?source=eq.${source}&fetched_at=gte.${since}`, config); // the count, from countRows
}

/** The newest journey we hold for one train, or null when we hold none */
export async function latestJourneyFor(
  trainNumber: string,
  config: DbConfig,
): Promise<JourneyRef | null> {
  const query = `journeys?train_number=eq.${trainNumber}&select=id,is_scored&order=journey_date.desc&limit=1`;
  const rows = JourneyRows.parse(await readRows(query, config)); // rows, from readRows
  const row = rows[0];
  return row === undefined ? null : { id: row.id, isScored: row.is_scored };
}

/** The stops of one train in route order, as the estimator wants them */
export async function timetableFor(
  trainNumber: string,
  config: DbConfig,
): Promise<TimetableStop[]> {
  const query = `timetable_stops?train_number=eq.${trainNumber}&select=seq,station_code,sched_arr,sched_dep,km&order=seq.asc`;
  const rows = StopRows.parse(await readRows(query, config)); // rows, from readRows
  return rows.map((row) => ({
    trainNumber,
    seq: row.seq,
    stationCode: row.station_code,
    schedArrMin: row.sched_arr,
    schedDepMin: row.sched_dep,
    km: row.km,
  }));
}

/** The top speed we hold for a train, null when the reference data does not say */
export async function topSpeedFor(trainNumber: string, config: DbConfig): Promise<number | null> {
  const query = `trains?number=eq.${trainNumber}&select=top_speed_kmh`;
  const rows = TrainRows.parse(await readRows(query, config)); // rows, from readRows
  return rows[0]?.top_speed_kmh ?? null;
}

/** The fastest pace ever seen on each of a train's sections */
export async function sectionCapsFor(
  trainNumber: string,
  config: DbConfig,
): Promise<SectionCapSeen[]> {
  const query = `section_caps?train_number=eq.${trainNumber}&select=from_seq,fastest_pace,trips_seen`;
  const rows = CapRows.parse(await readRows(query, config)); // rows, from readRows
  return rows.map((row) => ({
    fromSeq: row.from_seq,
    fastestPace: row.fastest_pace,
    tripsSeen: row.trips_seen,
  }));
}

/** Records what a finished journey ran its sections at, keeping the fastest we have seen */
export async function saveSectionCaps(
  trainNumber: string,
  caps: readonly SectionCapSeen[],
  now: IsoUtc,
  config: DbConfig,
): Promise<void> {
  if (caps.length === 0) {
    return;
  }
  const rows = caps.map((cap) => ({
    train_number: trainNumber,
    from_seq: cap.fromSeq,
    fastest_pace: cap.fastestPace,
    trips_seen: cap.tripsSeen,
    updated_at: now,
  }));
  await writeRows('section_caps', rows, config, 'train_number,from_seq');
}

/** Every confirmed event of one journey */
export async function resolvedFor(journeyId: string, config: DbConfig): Promise<ResolvedEvent[]> {
  const query = `resolved_events?journey_id=eq.${journeyId}&select=station_code,type,at,confidence_score,confidence,chosen_source,sources,resolved_at`;
  const rows = ResolvedRows.parse(await readRows(query, config)); // rows, from readRows
  return rows.map((row) => ({
    journeyId,
    stationCode: row.station_code,
    type: row.type as EventType,
    at: row.at,
    confidenceScore: row.confidence_score,
    confidence: row.confidence as Confidence,
    chosenSource: row.chosen_source as SourceId,
    sources: row.sources as SourceId[],
    resolvedAt: row.resolved_at,
  }));
}

/** What we last wrote about a journey, or null when we have never written any */
export async function stateFor(journeyId: string, config: DbConfig): Promise<StateMemory | null> {
  const query = `train_state?journey_id=eq.${journeyId}&select=next_check_at,updated_at`;
  const rows = StateRows.parse(await readRows(query, config)); // rows, from readRows
  const row = rows[0];
  return row === undefined ? null : { nextCheckAt: row.next_check_at, updatedAt: row.updated_at };
}

/** Saves what the sources said about one journey, rejections kept and labelled */
export async function saveSourceEvents(
  events: readonly SourceEvent[],
  journeyId: string,
  config: DbConfig,
): Promise<void> {
  if (events.length === 0) {
    return;
  }
  await writeRows(
    'source_events?select=id',
    events.map((event) => ({
      journey_id: journeyId,
      source: event.source,
      station_code: event.stationCode,
      type: event.type,
      at: event.at,
      fetched_at: event.fetchedAt,
      raw_fetch_id: event.rawFetchId,
      rejected: event.rejected ?? null,
    })),
    config,
  );
}

/** Replaces the confirmed events of one journey with the ones just resolved */
export async function saveResolvedEvents(
  events: readonly ResolvedEvent[],
  config: DbConfig,
): Promise<void> {
  if (events.length === 0) {
    return;
  }
  await writeRows(
    'resolved_events?select=journey_id',
    events.map((event) => ({
      journey_id: event.journeyId,
      station_code: event.stationCode,
      type: event.type,
      at: event.at,
      confidence_score: event.confidenceScore,
      confidence: event.confidence,
      chosen_source: event.chosenSource,
      sources: event.sources,
      resolved_at: event.resolvedAt,
    })),
    config,
    'journey_id,station_code,type',
  );
}

/** Writes the one row the browser reads, which Realtime then pushes */
export async function saveTrainState(state: TrainState, config: DbConfig): Promise<void> {
  await writeRows(
    'train_state?select=journey_id',
    {
      journey_id: state.journeyId,
      state: state.state satisfies TrainStateKind,
      km: state.km,
      lo_km: state.loKm,
      hi_km: state.hiKm,
      pace: state.pace,
      delay_min: state.delayMin,
      next_station: state.nextStation,
      window_start: state.window?.windowStart ?? null,
      window_end: state.window?.windowEnd ?? null,
      next_check_at: state.nextCheckAt,
      updated_at: state.updatedAt,
    },
    config,
    'journey_id',
  );
}
