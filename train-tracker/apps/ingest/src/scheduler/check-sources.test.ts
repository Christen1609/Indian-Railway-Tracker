import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HEALTHY } from '@train-tracker/core/schedule/health';
import { NOT_BLOCKED } from '@train-tracker/core/schedule/scrape-gate';
import { parseConfirmTktLive } from '@train-tracker/core/sources/confirmtkt';
import type { SourceEvent } from '@train-tracker/core/types';
import type { Config } from '../config.js';
import { callsThisMonth, saveSourceEvents } from '../db/journey-data.js';
import { lastRailRadarAt, railRadarCallsFor, triedSince } from '../db/raw-fetches.js';
import { askSources } from './check-sources.js';
import type { SourcesInput } from './check-sources.js';
import { readScrape, settleScrape } from './scrape.js';
import type { ReadOutcome, ScrapeRead, ScrapeSkip } from './scrape.js';

vi.mock('../db/journey-data.js');
vi.mock('../db/raw-fetches.js');
vi.mock('./scrape.js');
vi.mock('../log.js');

const PAGE = readFileSync(
  join(
    import.meta.dirname,
    '../../../../fixtures/confirmtkt/12951-2026-10-30T0435IST-date-29oct-running.html',
  ),
  'utf8',
);
const RUN = '2026-10-29';
const NOW = '2026-10-30T04:40:00.000Z';
const DUE_AT = '2026-10-30T04:38:00.000Z';
const EVENING = { now: '2026-10-29T15:55:00.000Z', dueAt: '2026-10-29T15:53:00.000Z' };
const STOPS = [
  { seq: 0, stationCode: 'BCT', km: 0, schedArrMin: null, schedDepMin: 1020 },
  { seq: 1, stationCode: 'BVI', km: 30, schedArrMin: 1040, schedDepMin: 1042 },
  { seq: 2, stationCode: 'ST', km: 263.6, schedArrMin: 1183, schedDepMin: 1188 },
  { seq: 3, stationCode: 'BRC', km: 393.2, schedArrMin: 1266, schedDepMin: 1276 },
  { seq: 4, stationCode: 'RTM', km: 653.6, schedArrMin: 1465, schedDepMin: 1468 },
  { seq: 5, stationCode: 'NAD', km: 697.4, schedArrMin: 1508, schedDepMin: 1510 },
  { seq: 6, stationCode: 'KOTA', km: 922.8, schedArrMin: 1635, schedDepMin: 1640 },
  { seq: 7, stationCode: 'NDLS', km: 1388.4, schedArrMin: 1952, schedDepMin: null },
].map((stop) => ({ ...stop, trainNumber: '12951' }));

const CONFIG = {
  db: { url: 'http://db', serviceRoleKey: 'k' },
  quota: { monthlyBudget: 100, demoReserve: 20 },
} as unknown as Config;

const INPUT: SourcesInput = {
  trainNumber: '12951',
  journey: { id: 'j1', isScored: false },
  config: CONFIG,
  now: NOW,
  dueAt: DUE_AT,
  context: {
    journeyDate: RUN,
    stops: STOPS,
    topSpeedKmh: 130,
    confirmed: [],
  },
  check: 'window_open',
  windowStart: '2026-10-30T04:30:00.000Z',
};

/** A page read from a source, with the real ConfirmTkt events unless others are given */
function read(
  source: ScrapeRead['source'],
  over: { outcome?: ReadOutcome; events?: SourceEvent[]; updatedAt?: string } = {},
): ScrapeRead {
  const parsed = parseConfirmTktLive(
    {
      source: 'confirmtkt_scrape',
      url: 'x',
      status: 200,
      body: PAGE,
      fetchedAt: NOW,
      latencyMs: 1,
    },
    'raw-1',
  );
  return {
    kind: 'read',
    source,
    outcome: over.outcome ?? 'ok',
    raw: { source, url: 'x', status: 200, body: '', fetchedAt: NOW, latencyMs: 1 },
    rawFetchId: 'raw-1',
    parsed: {
      ...parsed,
      ...(over.events === undefined ? {} : { events: over.events }),
      updatedAt: over.updatedAt ?? '2026-10-30T04:35:00.000Z',
    },
    call: { status: 200, hasError: false, parseErrors: 0 },
    health: HEALTHY,
    block: NOT_BLOCKED,
  };
}

/** Makes readScrape answer one source after another */
function answers(...steps: (ScrapeRead | { skip: ScrapeSkip; readyAt?: string })[]): void {
  const mocked = vi.mocked(readScrape);
  for (const step of steps) {
    mocked.mockResolvedValueOnce(
      'skip' in step ? { kind: 'skipped', reason: step.skip, readyAt: step.readyAt ?? null } : step,
    );
  }
}

/** The sources readScrape was asked for, in order */
function asked(): string[] {
  return vi.mocked(readScrape).mock.calls.map((call) => call[0].source);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(triedSince).mockResolvedValue([]);
  vi.mocked(callsThisMonth).mockResolvedValue(0);
  vi.mocked(railRadarCallsFor).mockResolvedValue(0);
  vi.mocked(lastRailRadarAt).mockResolvedValue(null);
  vi.mocked(settleScrape).mockImplementation((one) => Promise.resolve(one.outcome));
});

describe('askSources, a healthy check', () => {
  it('asks ConfirmTkt then RailYatri, and is done', async () => {
    answers(read('confirmtkt_scrape'), read('railyatri_scrape'));
    const result = await askSources(INPUT);
    expect(asked()).toEqual(['confirmtkt_scrape', 'railyatri_scrape']);
    expect(result.status).toBe('done');
    expect(result.readyAt).toBeNull();
  });

  it('saves the events of each page against the journey and hands them back', async () => {
    answers(read('confirmtkt_scrape'), read('railyatri_scrape'));
    const result = await askSources(INPUT);
    expect(saveSourceEvents).toHaveBeenCalledTimes(2);
    expect(vi.mocked(saveSourceEvents).mock.calls[0]?.[1]).toBe('j1');
    expect(result.events.length).toBe(26);
  });

  it('hands back the update time of each page it read', async () => {
    answers(
      read('confirmtkt_scrape', { updatedAt: '2026-10-30T04:25:00.000Z' }),
      read('railyatri_scrape', { updatedAt: '2026-10-30T04:35:00.000Z' }),
    );
    const result = await askSources(INPUT);
    expect(result.updatedAts).toEqual(['2026-10-30T04:25:00.000Z', '2026-10-30T04:35:00.000Z']);
  });

  it('settles each read with the unknown station codes after its events are checked', async () => {
    answers(read('confirmtkt_scrape'), read('railyatri_scrape'));
    await askSources(INPUT);
    expect(vi.mocked(settleScrape).mock.calls.map((call) => call[1])).toEqual([[], []]);
  });

  it('does not ask RailRadar while the scrapes work', async () => {
    answers(read('confirmtkt_scrape'), read('railyatri_scrape'));
    const result = await askSources(INPUT);
    expect(result.railRadar).toEqual({ ask: false, reason: 'scrapes_ok' });
  });

  it('asks nobody for a check an earlier pass already finished', async () => {
    vi.mocked(triedSince).mockResolvedValue([
      { source: 'confirmtkt_scrape', outcome: 'ok' },
      { source: 'railyatri_scrape', outcome: 'ok' },
    ]);
    const result = await askSources(INPUT);
    expect(readScrape).not.toHaveBeenCalled();
    expect(result.status).toBe('done');
  });

  it('reads what was tried since the check was due, for this journey', async () => {
    answers(read('confirmtkt_scrape'), read('railyatri_scrape'));
    await askSources(INPUT);
    expect(triedSince).toHaveBeenCalledWith('j1', DUE_AT, CONFIG.db);
  });
});

describe('askSources, the gate holding the check', () => {
  it.each(['too_soon', 'url_too_soon', 'robots_fetched'] as const)(
    'ends the pass with the ready time when %s',
    async (reason) => {
      answers(read('confirmtkt_scrape'), { skip: reason, readyAt: '2026-10-30T04:41:00.000Z' });
      const result = await askSources(INPUT);
      expect(result.status).toBe('held');
      expect(result.readyAt).toBe('2026-10-30T04:41:00.000Z');
    },
  );

  it('keeps the events of the pages read before the hold', async () => {
    answers(read('confirmtkt_scrape'), { skip: 'too_soon', readyAt: '2026-10-30T04:41:00.000Z' });
    const result = await askSources(INPUT);
    expect(result.events.length).toBe(13);
    expect(saveSourceEvents).toHaveBeenCalledTimes(1);
  });

  it('does not weigh RailRadar while held', async () => {
    answers({ skip: 'too_soon', readyAt: '2026-10-30T04:41:00.000Z' });
    const result = await askSources(INPUT);
    expect(result.railRadar).toBeNull();
    expect(railRadarCallsFor).not.toHaveBeenCalled();
  });

  it('waits a minute when the gate gave no ready time', async () => {
    answers({ skip: 'robots_fetched' });
    const result = await askSources(INPUT);
    expect(result.readyAt).toBe('2026-10-30T04:41:00.000Z');
  });
});

describe('askSources, skips that move on', () => {
  it.each([
    'disabled',
    'source_off',
    'no_slug',
    'date_unsupported',
    'circuit_open',
    'backing_off',
    'blocked',
    'daily_cap',
    'robots_disallowed',
  ] as const)('goes to the next source when one is skipped for %s', async (reason) => {
    answers({ skip: reason }, read('railyatri_scrape'), read('travelkhana_scrape'));
    const result = await askSources(INPUT);
    expect(asked().slice(0, 2)).toEqual(['confirmtkt_scrape', 'railyatri_scrape']);
    expect(result.status).toBe('done');
  });

  it('asks Travelkhana when ConfirmTkt was skipped', async () => {
    answers({ skip: 'blocked' }, read('railyatri_scrape'), read('travelkhana_scrape'));
    await askSources(INPUT);
    expect(asked()).toEqual(['confirmtkt_scrape', 'railyatri_scrape', 'travelkhana_scrape']);
  });

  it('works down to Railmitra, and then stops, when everything is skipped', async () => {
    const skip = { skip: 'circuit_open' } as const;
    answers(skip, skip, skip, skip, skip);
    const result = await askSources(INPUT);
    expect(asked()).toEqual([
      'confirmtkt_scrape',
      'railyatri_scrape',
      'goibibo_scrape',
      'travelkhana_scrape',
      'railmitra_scrape',
    ]);
    expect(result.status).toBe('done');
  });
});

describe('askSources, a page for another run', () => {
  it('drops its events and its update time, and moves on to Goibibo', async () => {
    answers(
      read('confirmtkt_scrape'),
      read('railyatri_scrape', { outcome: 'wrong_run', updatedAt: '2026-10-01T00:00:00.000Z' }),
      read('goibibo_scrape'),
    );
    const result = await askSources(INPUT);
    expect(asked()).toEqual(['confirmtkt_scrape', 'railyatri_scrape', 'goibibo_scrape']);
    expect(saveSourceEvents).toHaveBeenCalledTimes(2);
    expect(result.updatedAts).not.toContain('2026-10-01T00:00:00.000Z');
    expect(result.events.length).toBe(26);
  });
});

describe('askSources, unknown halts', () => {
  it('lists the events rejected as unknown_halt and settles with their codes', async () => {
    const stranger: SourceEvent = {
      source: 'confirmtkt_scrape',
      trainNumber: '12951',
      journeyDate: RUN,
      stationCode: 'ZZZZ',
      type: 'ARR',
      at: '2026-10-29T15:00:00.000Z',
      fetchedAt: NOW,
      rawFetchId: 'raw-1',
      isHalt: true,
      haltOrder: 3,
    };
    answers(read('confirmtkt_scrape', { events: [stranger] }), read('railyatri_scrape'));
    await askSources(INPUT);
    expect(vi.mocked(settleScrape).mock.calls[0]?.[1]).toEqual(['ZZZZ']);
  });

  it('keeps a read as a failure when settling says an unknown halt made it one', async () => {
    vi.mocked(settleScrape).mockResolvedValueOnce('failed').mockResolvedValueOnce('ok');
    answers(read('confirmtkt_scrape'), read('railyatri_scrape'), read('travelkhana_scrape'));
    await askSources(INPUT);
    expect(asked()).toEqual(['confirmtkt_scrape', 'railyatri_scrape', 'travelkhana_scrape']);
  });
});

describe('askSources, RailRadar after the scrapes', () => {
  it('asks as a fallback when every scrape was skipped or failed', async () => {
    const skip = { skip: 'circuit_open' } as const;
    answers(skip, skip, skip, skip, skip);
    const result = await askSources(INPUT);
    expect(result.railRadar).toEqual({ ask: true, reason: 'fallback' });
  });

  it('asks as a fallback when no scrape gave a read', async () => {
    vi.mocked(settleScrape).mockResolvedValue('failed');
    answers(read('confirmtkt_scrape'), read('railyatri_scrape'), read('goibibo_scrape'));
    answers(read('travelkhana_scrape'), read('railmitra_scrape'));
    const result = await askSources(INPUT);
    expect(result.railRadar?.reason).toBe('fallback');
  });

  it('asks on a scored trip at an arrival even when the scrapes work', async () => {
    answers(read('confirmtkt_scrape'), read('railyatri_scrape'));
    const result = await askSources({
      ...INPUT,
      ...EVENING,
      journey: { id: 'j1', isScored: true },
    });
    expect(result.railRadar).toEqual({ ask: true, reason: 'scored' });
  });

  it('is held to one call per timetabled arrival, from the count on this journey', async () => {
    vi.mocked(railRadarCallsFor).mockResolvedValue(7);
    answers(read('confirmtkt_scrape'), read('railyatri_scrape'));
    const result = await askSources({
      ...INPUT,
      ...EVENING,
      journey: { id: 'j1', isScored: true },
    });
    expect(result.railRadar).toEqual({ ask: false, reason: 'journey_cap' });
  });

  it('is held back by the reserve for a scored trip late in the month', async () => {
    vi.mocked(callsThisMonth).mockResolvedValue(80);
    answers(read('confirmtkt_scrape'), read('railyatri_scrape'));
    const result = await askSources({
      ...INPUT,
      ...EVENING,
      journey: { id: 'j1', isScored: true },
    });
    expect(result.railRadar).toEqual({ ask: false, reason: 'reserve_held' });
  });

  it('does not ask twice for one window', async () => {
    vi.mocked(lastRailRadarAt).mockResolvedValue('2026-10-30T04:35:00.000Z');
    answers(read('confirmtkt_scrape'), read('railyatri_scrape'));
    const result = await askSources({
      ...INPUT,
      ...EVENING,
      journey: { id: 'j1', isScored: true },
    });
    expect(result.railRadar?.reason).toBe('already_asked');
  });

  it('never asks on a departure check', async () => {
    answers(read('confirmtkt_scrape'), read('railyatri_scrape'));
    const result = await askSources({ ...INPUT, check: 'departure' });
    expect(result.railRadar).toEqual({ ask: false, reason: 'not_due' });
  });
});
