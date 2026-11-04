// Features: journey load, train search, timetable request, realtime subscription, clock tick

import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import type {
  IsoUtc,
  Journey,
  Station,
  TimetableStop,
  Train,
  TrainState,
} from '@train-tracker/core/types';
import {
  cleanQuery,
  planSearch,
  rankTrains,
  SEARCH_DEBOUNCE_MS,
  SUGGESTION_LIMIT,
  toCandidates,
} from '../features/search/search';
import type { Candidate } from '../features/search/search';
import type { WatchStatus } from './rows';
import type { Watch } from '../features/status/page-state';
import { supabase } from './supabase';
import {
  JourneyRow,
  StationRow,
  StopEventRow,
  TimetableStopRow,
  TrainRow,
  TrainStateRow,
  WatchRequestRow,
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

export type SearchResult = { candidates: Candidate[]; isSettled: boolean };

export type Tracked = { load: Load; watch: Watch };

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
    throw new Error(
      `We don’t know a train numbered ${trainNumber}. Check the number and try again.`,
    );
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

/** The status in a request_train reply, whether it is one row or a list of one */
function statusOfReply(data: unknown): WatchStatus | null {
  const parsed = z.union([WatchRequestRow, z.array(WatchRequestRow)]).safeParse(data);
  if (!parsed.success) {
    return null;
  }
  const row = Array.isArray(parsed.data) ? parsed.data[0] : parsed.data;
  return row?.status ?? null;
}

/** Asks for a train's timetable once, then follows the request and new journeys until the page closes */
function useTimetableRequest(
  trainNumber: string,
  isKnown: boolean,
  hasTimetable: boolean,
  reload: () => void,
): Watch {
  const [watch, setWatch] = useState<{ trainNumber: string; status: Watch } | null>(null);
  const hasTimetableRef = useRef(hasTimetable);
  hasTimetableRef.current = hasTimetable;

  useEffect(() => {
    if (!isKnown) {
      return;
    }
    let isCurrent = true;

    /** Records a status, reloading the journey when the timetable has just become ready */
    const update = (status: Watch) => {
      if (!isCurrent) {
        return;
      }
      setWatch({ trainNumber, status });
      if (status === 'ready' && !hasTimetableRef.current) {
        reload();
      }
    };

    const channel = supabase
      .channel(`watch-${trainNumber}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'watch_requests',
          filter: `train_number=eq.${trainNumber}`,
        },
        (payload) => {
          const parsed = WatchRequestRow.safeParse(payload.new);
          if (parsed.success) {
            update(parsed.data.status);
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'journeys',
          filter: `train_number=eq.${trainNumber}`,
        },
        () => {
          if (isCurrent) {
            reload();
          }
        },
      )
      .subscribe();
    supabase.rpc('request_train', { p_train_number: trainNumber }).then(
      ({ data, error }) => update(error === null ? statusOfReply(data) : 'unavailable'),
      () => update('unavailable'),
    );

    return () => {
      isCurrent = false;
      void supabase.removeChannel(channel);
    };
  }, [trainNumber, isKnown, reload]);

  return watch?.trainNumber === trainNumber ? watch.status : null;
}

/** The latest journey of a train, kept current by Realtime, with the state of its timetable request */
export function useLiveJourney(trainNumber: string): Tracked {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [reloadCount, setReloadCount] = useState(0);
  const journeyId = load.kind === 'ready' ? load.view.journey?.id : undefined;
  const reload = useCallback(() => setReloadCount((count) => count + 1), []);

  useEffect(() => {
    let isCurrent = true;
    setLoad((current) =>
      current.kind === 'ready' && current.view.train.number === trainNumber
        ? current
        : { kind: 'loading' },
    );
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
  }, [trainNumber, reloadCount]);

  const isKnown = load.kind === 'ready' && load.view.train.number === trainNumber;
  const hasTimetable = load.kind === 'ready' && load.view.stops.length > 0;
  const watch = useTimetableRequest(trainNumber, isKnown, hasTimetable, reload);

  useEffect(() => {
    if (journeyId === undefined) {
      return;
    }
    let isCurrent = true;

    /** Reloads the live data, keeping the last good view when the read fails */
    const refresh = () => {
      loadLive(journeyId).then(
        (live) => {
          if (isCurrent) {
            setLoad((current) =>
              current.kind === 'ready'
                ? { kind: 'ready', view: { ...current.view, ...live } }
                : current,
            );
          }
        },
        (error: unknown) => console.warn(describeError(error)),
      );
    };

    /** Reloads when the tab comes back into view */
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        refresh();
      }
    };

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
        refresh,
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          refresh();
        }
      });
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('online', refresh);

    return () => {
      isCurrent = false;
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('online', refresh);
      void supabase.removeChannel(channel);
    };
  }, [journeyId]);

  return { load, watch };
}

/** Suggestions for the typed text, fetched once typing pauses */
export function useTrainSearch(query: string): SearchResult {
  const [result, setResult] = useState<{ query: string; candidates: Candidate[] } | null>(null);
  const text = cleanQuery(query);

  useEffect(() => {
    const plan = planSearch(text);
    if (plan === null) {
      return;
    }
    let isCurrent = true;
    const timer = setTimeout(() => {
      const column = supabase.from('trains').select('*');
      const matching =
        plan.column === 'number'
          ? column.like('number', plan.pattern).order('number')
          : column.ilike('name', plan.pattern).order('name');
      readRows(TrainRow, matching.limit(SUGGESTION_LIMIT), 'the trains').then(
        (trains) => {
          if (isCurrent) {
            setResult({ query: text, candidates: rankTrains(text, toCandidates(trains)) });
          }
        },
        (error: unknown) => console.warn(describeError(error)),
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [text]);

  const isSettled = text === '' || result?.query === text;
  return { candidates: text === '' || result === null ? [] : result.candidates, isSettled };
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
