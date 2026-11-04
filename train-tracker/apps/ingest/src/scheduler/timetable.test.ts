import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPage } from '../adapters/scrape.js';
import type { Config } from '../config.js';
import { timetableFor } from '../db/journey-data.js';
import { insertRawFetch } from '../db/raw-fetches.js';
import {
  answerRequest,
  pendingRequests,
  requestedSince,
  saveTimetable,
} from '../db/watch-requests.js';
import { prepareScrape, settleScrape } from './scrape.js';
import { settleRequests, watchList } from './timetable.js';

vi.mock('../adapters/scrape.js');
vi.mock('../db/journey-data.js');
vi.mock('../db/watch-requests.js');
vi.mock('../db/raw-fetches.js', async (original) => ({
  ...(await original<typeof import('../db/raw-fetches.js')>()),
  insertRawFetch: vi.fn(),
}));
vi.mock('../log.js');
vi.mock('./scrape.js', async (original) => ({
  ...(await original<typeof import('./scrape.js')>()),
  prepareScrape: vi.fn(),
  settleScrape: vi.fn(),
}));

const PAGE = readFileSync(
  join(
    import.meta.dirname,
    '../../../../fixtures/goibibo/12627-2026-11-04T1055IST-timetable-excerpt.html',
  ),
  'utf8',
);
const NOW = '2026-11-04T05:30:00.000Z';
const CONFIG = { db: { url: 'http://db', serviceRoleKey: 'k' } } as unknown as Config;
const READY = {
  kind: 'ready',
  url: 'https://www.goibibo.com/trains/live-train-status/12627-running-status/',
  health: { failures: 0, openedAt: null },
  block: { blockedAt: null, blockCount: 0 },
} as unknown as Awaited<ReturnType<typeof prepareScrape>>;

/** The page as the adapter would hand it back */
function reply(body: string, status = 200): Awaited<ReturnType<typeof fetchPage>> {
  return {
    source: 'goibibo_scrape',
    url: 'u',
    status,
    body,
    fetchedAt: NOW,
    latencyMs: 30,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(pendingRequests).mockResolvedValue(['12627']);
  vi.mocked(timetableFor).mockResolvedValue([]);
  vi.mocked(prepareScrape).mockResolvedValue(READY);
  vi.mocked(fetchPage).mockResolvedValue(reply(PAGE));
  vi.mocked(insertRawFetch).mockResolvedValue('raw-1');
});

describe('settleRequests', () => {
  it('fetches once, saves the halts and run days, and marks the request ready', async () => {
    expect(await settleRequests(CONFIG, NOW)).toBeNull();

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(saveTimetable).toHaveBeenCalledWith('12627', expect.any(Array), 127, CONFIG.db);
    expect(vi.mocked(saveTimetable).mock.calls[0]?.[1]).toHaveLength(35);
    expect(answerRequest).toHaveBeenCalledWith('12627', 'ready', null, NOW, CONFIG.db);
    expect(settleScrape).toHaveBeenCalledTimes(1);
  });

  it('marks a train ready without fetching when it already has a timetable', async () => {
    vi.mocked(timetableFor).mockResolvedValue([
      {
        trainNumber: '12627',
        seq: 0,
        stationCode: 'SBC',
        schedArrMin: null,
        schedDepMin: 1,
        km: 0,
      },
    ]);
    await settleRequests(CONFIG, NOW);

    expect(prepareScrape).not.toHaveBeenCalled();
    expect(fetchPage).not.toHaveBeenCalled();
    expect(answerRequest).toHaveBeenCalledWith('12627', 'ready', null, NOW, CONFIG.db);
  });

  it('marks the request failed when the page has no timetable, and does not hurt the source', async () => {
    vi.mocked(fetchPage).mockResolvedValue(reply('<html></html>'));
    await settleRequests(CONFIG, NOW);

    expect(saveTimetable).not.toHaveBeenCalled();
    expect(answerRequest).toHaveBeenCalledWith(
      '12627',
      'failed',
      expect.stringContaining('__NEXT_DATA__'),
      NOW,
      CONFIG.db,
    );
    const read = vi.mocked(settleScrape).mock.calls[0]?.[0];
    expect(read?.outcome).toBe('ok');
  });

  it('does not count a 404 against the source', async () => {
    vi.mocked(fetchPage).mockResolvedValue(reply('', 404));
    await settleRequests(CONFIG, NOW);

    expect(settleScrape).not.toHaveBeenCalled();
    expect(answerRequest).toHaveBeenCalledWith(
      '12627',
      'failed',
      expect.any(String),
      NOW,
      CONFIG.db,
    );
  });

  it('leaves the request pending and says when to retry when the gate holds the fetch', async () => {
    const readyAt = '2026-11-04T05:31:00.000Z';
    vi.mocked(prepareScrape).mockResolvedValue({ kind: 'skipped', reason: 'too_soon', readyAt });

    expect(await settleRequests(CONFIG, NOW)).toBe(readyAt);
    expect(fetchPage).not.toHaveBeenCalled();
    expect(answerRequest).not.toHaveBeenCalled();
  });

  it('fails the request when the site may not be asked at all', async () => {
    vi.mocked(prepareScrape).mockResolvedValue({
      kind: 'skipped',
      reason: 'robots_disallowed',
      readyAt: null,
    });
    await settleRequests(CONFIG, NOW);

    expect(answerRequest).toHaveBeenCalledWith(
      '12627',
      'failed',
      expect.stringContaining('robots_disallowed'),
      NOW,
      CONFIG.db,
    );
  });

  it('carries on with the next request when one throws', async () => {
    vi.mocked(pendingRequests).mockResolvedValue(['11111', '12627']);
    vi.mocked(timetableFor).mockRejectedValueOnce(new Error('db down'));
    await settleRequests(CONFIG, NOW);

    expect(answerRequest).toHaveBeenCalledWith('12627', 'ready', null, NOW, CONFIG.db);
  });
});

describe('watchList', () => {
  it('puts the named trains first and adds the requested ones once', async () => {
    vi.mocked(requestedSince).mockResolvedValue(['12627', '12951']);
    expect(await watchList(['12951'], CONFIG, NOW)).toEqual(['12951', '12627']);
  });

  it('asks for the last 3 days of requests and no more than 25', async () => {
    vi.mocked(requestedSince).mockResolvedValue([]);
    expect(await watchList([], CONFIG, NOW)).toEqual([]);
    expect(requestedSince).toHaveBeenCalledWith('2026-11-01T05:30:00.000Z', 25, CONFIG.db);
  });
});
