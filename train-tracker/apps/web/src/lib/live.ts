// Features: journey load, tracked trains load, realtime subscription, clock tick

import { useEffect, useState } from 'react';
import { z } from 'zod';
import type {
  IsoUtc,
  Journey,
  Station,
  TimetableStop,
  Train,
  TrainState,
} from '@train-tracker/core/types';
import { supabase } from './supabase';
import {
  JourneyRow,
  StationRow,
  StopEventRow,
  TimetableStopRow,
  TrainRow,
  TrainStateRow,
} from './rows';
import type { StopEvent } from './rows';

const TICK_MS = 1000;
const LOAD_FAILED = 'Could not load this train. Check the connection and reload.';

export type JourneyView = {
  train: Train;
  stops: TimetableStop[];
  stations: Map<string, Station>;
  journey: Journey | null;
  state: TrainState | null;
  events: StopEvent[];
};

export type Load =
  { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; view: JourneyView };

export type TrackedLoad =
  { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; trains: Train[] };

type LiveView = Pick<JourneyView, 'state' | 'events'>;

type Reply = PromiseLike<{ data: unknown; error: { message: string } | null }>;

/** Rows a query returns, parsed with their schema */
async function readRows<Row>(schema: z.ZodType<Row>, query: Reply, what: string): Promise<Row[]> {
  const { data, error } = await query;
  if (error) {
    throw new Error(`Could not read ${what}. ${error.message}. Check the connection and reload.`);
  }
  const parsed = z.array(schema).safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `Could not read ${what}. Unexpected data at ${issue?.path.join('.')}: ${issue?.message}.`,
    );
  }
  return parsed.data;
}

/** A journey's state and confirmed stop times */
async function loadLive(journeyId: string): Promise<LiveView> {
  const [states, events] = await Promise.all([
    readRows(
      TrainStateRow,
      supabase.from('train_state').select('*').eq('journey_id', journeyId),
      'the train state',
    ),
    readRows(
      StopEventRow,
      supabase.from('stop_times').select('station_code,type,at').eq('journey_id', journeyId),
      'the stop times',
    ),
  ]);
  return { state: states[0] ?? null, events };
}

/** A train's timetable, stations and latest journey with its live data */
async function loadJourney(trainNumber: string): Promise<JourneyView> {
  const [trains, stops, journeys] = await Promise.all([
    readRows(TrainRow, supabase.from('trains').select('*').eq('number', trainNumber), 'the train'),
    readRows(
      TimetableStopRow,
      supabase.from('timetable_stops').select('*').eq('train_number', trainNumber).order('seq'),
      'the timetable',
    ),
    readRows(
      JourneyRow,
      supabase
        .from('journeys')
        .select('*')
        .eq('train_number', trainNumber)
        .order('journey_date', { ascending: false })
        .limit(1),
      'the latest journey',
    ),
  ]);
  const train = trains[0];
  if (train === undefined) {
    throw new Error(`No train numbered ${trainNumber} is in the timetable.`);
  }
  const journey = journeys[0] ?? null;
  const [stations, live] = await Promise.all([
    readRows(
      StationRow,
      supabase
        .from('stations')
        .select('*')
        .in(
          'code',
          stops.map((stop) => stop.stationCode),
        ),
      'the stations',
    ),
    journey === null ? { state: null, events: [] } : loadLive(journey.id), // state and events, from loadLive
  ]);
  return {
    train,
    stops,
    stations: new Map(stations.map((station) => [station.code, station])),
    journey,
    ...live,
  };
}

/** Text for a failure, from its message when it has one */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : LOAD_FAILED;
}

/** The latest journey of a train, kept current by Realtime */
export function useLiveJourney(trainNumber: string): Load {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const journeyId = load.kind === 'ready' ? load.view.journey?.id : undefined;

  useEffect(() => {
    let isCurrent = true;
    setLoad({ kind: 'loading' });
    loadJourney(trainNumber).then(
      (view) => {
        if (isCurrent) {
          setLoad({ kind: 'ready', view });
        }
      },
      (error: unknown) => {
        if (isCurrent) {
          setLoad({ kind: 'error', message: describeError(error) });
        }
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [trainNumber]);

  useEffect(() => {
    if (journeyId === undefined) {
      return;
    }
    const channel = supabase
      .channel(`train-state-${journeyId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'train_state',
          filter: `journey_id=eq.${journeyId}`,
        },
        () => {
          loadLive(journeyId).then(
            (live) =>
              setLoad((current) =>
                current.kind === 'ready'
                  ? { kind: 'ready', view: { ...current.view, ...live } }
                  : current,
              ),
            (error: unknown) => setLoad({ kind: 'error', message: describeError(error) }),
          );
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [journeyId]);

  return load;
}

/** The trains in the timetable among the given numbers */
export function useTrackedTrains(trainNumbers: readonly string[]): TrackedLoad {
  const [load, setLoad] = useState<TrackedLoad>({ kind: 'loading' });

  useEffect(() => {
    let isCurrent = true;
    readRows(
      TrainRow,
      supabase.from('trains').select('*').in('number', trainNumbers),
      'the trains',
    ).then(
      (trains) => {
        if (isCurrent) {
          setLoad({ kind: 'ready', trains });
        }
      },
      (error: unknown) => {
        if (isCurrent) {
          setLoad({ kind: 'error', message: describeError(error) });
        }
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [trainNumbers]);

  return load;
}

/** The current instant, refreshed every second for relative text only */
export function useNow(): IsoUtc {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date().toISOString()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}
