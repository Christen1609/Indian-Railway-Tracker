import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveEvents } from '@train-tracker/core/fusion/resolve';
import { HEALTHY, afterFailure } from '@train-tracker/core/schedule/health';
import { timetableMinuteToUtc } from '@train-tracker/core/time';
import type { EventType, RawFetch, ResolvedEvent } from '@train-tracker/core/types';
import {
  JOURNEY_DATE,
  STOPS_12951 as STOPS,
} from '../../../../packages/core/src/testing/journey-12951.js';
import { fetchRailRadarLive } from '../adapters/railradar.js';
import type { Config } from '../config.js';
import {
  journeyFor,
  journeyStatusOn,
  resolvedFor,
  saveResolvedEvents,
  saveSourceEvents,
  saveTrainState,
  sectionCapsFor,
  sourceEventsFor,
  stateFor,
  stationPointsFor,
  timetableFor,
  topSpeedFor,
} from '../db/journey-data.js';
import { insertRawFetch, readsFor } from '../db/raw-fetches.js';
import { healthFor, saveHealth } from '../db/source-health.js';
import { askSources } from './check-sources.js';
import type { SourcesResult } from './check-sources.js';
import { checkJourney } from './check-journey.js';
import type { CheckInput } from './check-journey.js';
import { settleScrape } from './scrape.js';

vi.mock('../adapters/railradar.js');
vi.mock('../db/journey-data.js');
vi.mock('../db/raw-fetches.js', async (original) => ({
  ...(await original<typeof import('../db/raw-fetches.js')>()),
  insertRawFetch: vi.fn(),
  readsFor: vi.fn(),
}));
vi.mock('../db/source-health.js');
vi.mock('../log.js');
vi.mock('./check-sources.js');
vi.mock('./scrape.js');
vi.mock('@train-tracker/core/fusion/resolve', async (original) => {
  const real = await original<typeof import('@train-tracker/core/fusion/resolve')>();
  return { ...real, resolveEvents: vi.fn(real.resolveEvents) };
});

const RADAR_BODY = readFileSync(
  join(import.meta.dirname, '../../../../fixtures/railradar/12951-live.json'),
  'utf8',
);
const EVENING = timetableMinuteToUtc(JOURNEY_DATE, 1050);
const EARLY_MORNING = timetableMinuteToUtc(JOURNEY_DATE, 240);
const DUE_AT = timetableMinuteToUtc(JOURNEY_DATE, 1045);
const CONFIG = {
  db: { url: 'http://db', serviceRoleKey: 'k' },
  railRadarApiKey: 'key',
  intervals: { windowMin: 5, lateMin: [5, 5, 10, 10, 15], departureDelayMin: 2 },
} as unknown as Config;
const DONE: SourcesResult = {
  status: 'done',
  readyAt: null,
  events: [],
  updatedAts: [],
  railRadar: { ask: false, reason: 'scrapes_ok' },
};

/** The input to one check at a moment, due a little earlier */
function input(now: string, over: Partial<CheckInput> = {}): CheckInput {
  return {
    trainNumber: '12951',
    config: CONFIG,
    watchingSince: timetableMinuteToUtc(JOURNEY_DATE, 1000),
    dueAt: DUE_AT,
    now,
    ...over,
  };
}

/** A resolved event at the given timetable minute */
function resolved(stationCode: string, type: EventType, minute: number): ResolvedEvent {
  const at = timetableMinuteToUtc(JOURNEY_DATE, minute);
  return {
    journeyId: 'j1',
    stationCode,
    type,
    at,
    confidenceScore: 1,
    confidence: 'high',
    chosenSource: 'confirmtkt_scrape',
    sources: ['confirmtkt_scrape'],
    resolvedAt: at,
  };
}

/** RailRadar's reply as the adapter hands it over */
function radarReply(over: Partial<RawFetch> = {}): RawFetch {
  return {
    source: 'railradar',
    url: 'https://api.railradar.in/v1/trains/12951/live',
    status: 200,
    body: RADAR_BODY,
    fetchedAt: EVENING,
    latencyMs: 300,
    ...over,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(timetableFor).mockResolvedValue(STOPS);
  vi.mocked(topSpeedFor).mockResolvedValue(130);
  vi.mocked(sectionCapsFor).mockResolvedValue([]);
  vi.mocked(journeyStatusOn).mockResolvedValue(null);
  vi.mocked(journeyFor).mockResolvedValue({ id: 'j1', isScored: false });
  vi.mocked(resolvedFor).mockResolvedValue([]);
  vi.mocked(stateFor).mockResolvedValue({ nextCheckAt: DUE_AT, updatedAt: DUE_AT });
  vi.mocked(stationPointsFor).mockResolvedValue(new Map());
  vi.mocked(sourceEventsFor).mockResolvedValue([]);
  vi.mocked(readsFor).mockResolvedValue([]);
  vi.mocked(healthFor).mockResolvedValue(HEALTHY);
  vi.mocked(insertRawFetch).mockResolvedValue('raw-1');
  vi.mocked(askSources).mockResolvedValue(DONE);
  vi.mocked(fetchRailRadarLive).mockResolvedValue(radarReply());
});

describe('checkJourney, the run date comes first', () => {
  it('works out the run from the timetable and the clock, then finds the journey, then asks the sources', async () => {
    await checkJourney(input(EVENING));

    expect(journeyStatusOn).toHaveBeenCalledWith('12951', '2026-10-20', CONFIG.db);
    expect(journeyFor).toHaveBeenCalledWith('12951', JOURNEY_DATE, CONFIG.db);
    expect(vi.mocked(journeyFor).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(askSources).mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('follows yesterday run in the small hours while it is still running', async () => {
    vi.mocked(journeyStatusOn).mockResolvedValue('running');
    await checkJourney(input(EARLY_MORNING));
    expect(journeyFor).toHaveBeenCalledWith('12951', '2026-10-20', CONFIG.db);
  });

  it('moves to the new run once yesterday arrived', async () => {
    vi.mocked(journeyStatusOn).mockResolvedValue('arrived');
    await checkJourney(input(EARLY_MORNING));
    expect(journeyFor).toHaveBeenCalledWith('12951', JOURNEY_DATE, CONFIG.db);
  });

  it('hands the run date, the due time and the context to the sources', async () => {
    await checkJourney(input(EVENING));
    const asked = vi.mocked(askSources).mock.calls[0]?.[0];
    expect(asked).toMatchObject({ trainNumber: '12951', dueAt: DUE_AT, now: EVENING });
    expect(asked?.context.journeyDate).toBe(JOURNEY_DATE);
  });
});

describe('checkJourney, why the check is due', () => {
  it('is a catch-up when nothing was written about the journey yet', async () => {
    vi.mocked(stateFor).mockResolvedValue(null);
    await checkJourney(input(EVENING));
    expect(vi.mocked(askSources).mock.calls[0]?.[0].check).toBe('catch_up');
  });

  it('is a departure check until the train is confirmed to have left', async () => {
    await checkJourney(input(EVENING));
    expect(vi.mocked(askSources).mock.calls[0]?.[0].check).toBe('departure');
  });

  it('is an arrival check once the train has left', async () => {
    vi.mocked(resolvedFor).mockResolvedValue([resolved('BCT', 'DEP', 1022)]);
    await checkJourney(input(EVENING));
    expect(vi.mocked(askSources).mock.calls[0]?.[0].check).toBe('window_open');
  });
});

describe('checkJourney, a healthy two-source check', () => {
  it('saves the state once, from the events the sources gave, and settles nothing itself', async () => {
    const outcome = await checkJourney(input(EVENING));

    expect(outcome).toMatchObject({ kind: 'done', journeyId: 'j1', journeyDate: JOURNEY_DATE });
    expect(saveResolvedEvents).toHaveBeenCalledTimes(1);
    expect(saveTrainState).toHaveBeenCalledTimes(1);
    expect(vi.mocked(saveTrainState).mock.calls[0]?.[0]).toMatchObject({
      journeyId: 'j1',
      updatedAt: EVENING,
    });
    expect(settleScrape).not.toHaveBeenCalled();
  });

  it('does not call RailRadar when the plan says no', async () => {
    await checkJourney(input(EVENING));
    expect(fetchRailRadarLive).not.toHaveBeenCalled();
  });

  it('sets the next check from the ladder, not the time this one was due', async () => {
    const outcome = await checkJourney(input(EVENING));
    expect(outcome.kind === 'done' && outcome.nextCheckAt).not.toBe(DUE_AT);
  });
});

describe('checkJourney, the gate holding the check', () => {
  const held: SourcesResult = {
    ...DONE,
    status: 'held',
    readyAt: '2026-10-21T12:02:00.000Z',
    railRadar: null,
  };

  it('keeps nextCheckAt at the due time and hands back the ready time', async () => {
    const event = {
      source: 'confirmtkt_scrape',
      trainNumber: '12951',
      journeyDate: JOURNEY_DATE,
      stationCode: 'BCT',
      type: 'DEP',
      at: timetableMinuteToUtc(JOURNEY_DATE, 1022),
      fetchedAt: EVENING,
      rawFetchId: 'raw-1',
    } as const;
    vi.mocked(askSources).mockResolvedValue({ ...held, events: [event] });

    const outcome = await checkJourney(input(EVENING));

    expect(outcome).toEqual({ kind: 'held', readyAt: '2026-10-21T12:02:00.000Z' });
    expect(vi.mocked(saveTrainState).mock.calls[0]?.[0].nextCheckAt).toBe(DUE_AT);
  });

  it('writes nothing when the hold came before any page was read', async () => {
    vi.mocked(askSources).mockResolvedValue(held);
    const outcome = await checkJourney(input(EVENING));
    expect(outcome).toEqual({ kind: 'held', readyAt: '2026-10-21T12:02:00.000Z' });
    expect(saveTrainState).not.toHaveBeenCalled();
    expect(saveResolvedEvents).not.toHaveBeenCalled();
  });

  it('never calls RailRadar while held', async () => {
    vi.mocked(askSources).mockResolvedValue({
      ...held,
      railRadar: { ask: true, reason: 'fallback' },
    });
    await checkJourney(input(EVENING));
    expect(fetchRailRadarLive).not.toHaveBeenCalled();
  });
});

describe('checkJourney, RailRadar when the plan asks', () => {
  beforeEach(() => {
    vi.mocked(askSources).mockResolvedValue({
      ...DONE,
      railRadar: { ask: true, reason: 'fallback' },
    });
  });

  it('stores the reply against the journey, parses it, then records the health', async () => {
    await checkJourney(input(EVENING));

    expect(fetchRailRadarLive).toHaveBeenCalledWith('12951', 'key');
    expect(vi.mocked(insertRawFetch).mock.calls[0]?.[0]).toMatchObject({
      journey_id: 'j1',
      source: 'railradar',
      error: null,
    });
    expect(saveSourceEvents).toHaveBeenCalledTimes(1);
    expect(vi.mocked(insertRawFetch).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(saveHealth).mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('has already stored the reply when recording the health fails', async () => {
    vi.mocked(saveHealth).mockRejectedValue(new Error('db down'));

    await expect(checkJourney(input(EVENING))).rejects.toThrow('db down');

    expect(insertRawFetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(insertRawFetch).mock.calls[0]?.[0]).toMatchObject({
      journey_id: 'j1',
      body: RADAR_BODY,
    });
  });

  it('stores a reply for another run as wrong_run, and counts neither a failure nor an event', async () => {
    const nextDay = timetableMinuteToUtc('2026-10-22', 1050);
    await checkJourney(input(nextDay, { dueAt: timetableMinuteToUtc('2026-10-22', 1045) }));

    expect(vi.mocked(insertRawFetch).mock.calls[0]?.[0]).toMatchObject({
      journey_id: 'j1',
      error: 'wrong_run',
    });
    expect(saveHealth).not.toHaveBeenCalled();
    expect(saveSourceEvents).not.toHaveBeenCalled();
  });

  it('records a failure and saves nothing for a reply it cannot read', async () => {
    vi.mocked(fetchRailRadarLive).mockResolvedValue(
      radarReply({ status: 502, body: 'Bad gateway' }),
    );
    await checkJourney(input(EVENING));
    expect(vi.mocked(saveHealth).mock.calls[0]?.[1]).toMatchObject({ failures: 1 });
    expect(saveSourceEvents).not.toHaveBeenCalled();
    expect(insertRawFetch).toHaveBeenCalledTimes(1);
  });

  it('is not called while its circuit is open', async () => {
    let health = HEALTHY;
    for (let count = 0; count < 5; count += 1) {
      health = afterFailure(health, EVENING, false);
    }
    vi.mocked(healthFor).mockResolvedValue(health);
    await checkJourney(input(EVENING));
    expect(fetchRailRadarLive).not.toHaveBeenCalled();
  });
});

describe('checkJourney, a stalled feed', () => {
  const afterWindow = timetableMinuteToUtc(JOURNEY_DATE, 1300);
  const confirmed = [
    resolved('BCT', 'DEP', 1020),
    resolved('BVI', 'ARR', 1040),
    resolved('BVI', 'DEP', 1042),
  ];

  beforeEach(() => {
    vi.mocked(resolvedFor).mockResolvedValue(confirmed);
    vi.mocked(resolveEvents).mockReturnValue(confirmed);
  });

  it('does not call the train late when the newest page is over 30 minutes old', async () => {
    vi.mocked(askSources).mockResolvedValue({
      ...DONE,
      updatedAts: [timetableMinuteToUtc(JOURNEY_DATE, 1200)],
    });
    await checkJourney(input(afterWindow));
    expect(vi.mocked(saveTrainState).mock.calls[0]?.[0].state).toBe('running');
  });

  it('calls the train late when the pages are fresh and the arrival is still missing', async () => {
    vi.mocked(askSources).mockResolvedValue({
      ...DONE,
      updatedAts: [timetableMinuteToUtc(JOURNEY_DATE, 1295)],
    });
    await checkJourney(input(afterWindow));
    expect(vi.mocked(saveTrainState).mock.calls[0]?.[0].state).toBe('late');
  });

  it('does not call a pageless check stalled', async () => {
    await checkJourney(input(afterWindow));
    expect(vi.mocked(saveTrainState).mock.calls[0]?.[0].state).toBe('late');
  });
});
