import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HEALTHY, afterFailure } from '@train-tracker/core/schedule/health';
import { NOT_BLOCKED, afterBlock } from '@train-tracker/core/schedule/scrape-gate';
import type { RawFetch } from '@train-tracker/core/types';
import { fetchPage } from '../adapters/scrape.js';
import type { Config } from '../config.js';
import { insertRawFetch, robotsFor, scrapeStateFor } from '../db/raw-fetches.js';
import { blockFor, healthFor } from '../db/source-health.js';
import { prepareScrape } from './scrape.js';
import type { ScrapeInput } from './scrape.js';

vi.mock('../adapters/scrape.js');
vi.mock('../log.js');
vi.mock('../db/source-health.js');
vi.mock('../db/raw-fetches.js', async (original) => ({
  ...(await original<typeof import('../db/raw-fetches.js')>()),
  insertRawFetch: vi.fn(),
  robotsFor: vi.fn(),
  scrapeStateFor: vi.fn(),
}));

const NOW = '2026-10-30T04:40:00.000Z';
const RUN = '2026-10-29';
const ALLOW_ALL = { status: 200, body: 'User-agent: *\nDisallow:' };
const HELD_ROBOTS = { reply: ALLOW_ALL, fetchedAt: '2026-10-30T03:00:00.000Z' };

const CONFIG = {
  db: { url: 'http://db', serviceRoleKey: 'k' },
  scrape: {
    isEnabled: true,
    sources: ['goibibo_scrape', 'confirmtkt_scrape', 'travelkhana_scrape'],
    dailyCap: 300,
    slugs: { '12951': { travelkhana: 'Mumbai-Central', railmitra: 'mumbai-rajdhani' } },
  },
} as unknown as Config;

const INPUT: ScrapeInput = {
  source: 'confirmtkt_scrape',
  trainNumber: '12951',
  journeyDate: RUN,
  journeyId: 'j1',
  config: CONFIG,
  now: NOW,
};

/** A reply from a site, as the fetch helper hands it over */
function replied(body: string, over: Partial<RawFetch> = {}): RawFetch {
  return {
    source: 'confirmtkt_scrape',
    url: 'https://www.confirmtkt.com/robots.txt',
    status: 200,
    body,
    fetchedAt: NOW,
    latencyMs: 90,
    ...over,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(healthFor).mockResolvedValue(HEALTHY);
  vi.mocked(blockFor).mockResolvedValue(NOT_BLOCKED);
  vi.mocked(scrapeStateFor).mockResolvedValue({
    lastAnyAt: null,
    lastUrlAt: null,
    fetchedToday: 0,
  });
  vi.mocked(robotsFor).mockResolvedValue(HELD_ROBOTS);
  vi.mocked(insertRawFetch).mockResolvedValue('raw-1');
});

describe('prepareScrape, the switches and the address', () => {
  it('does nothing when scraping is switched off', async () => {
    const config = { ...CONFIG, scrape: { ...CONFIG.scrape, isEnabled: false } } as Config;
    expect(await prepareScrape({ ...INPUT, config })).toMatchObject({
      kind: 'skipped',
      reason: 'disabled',
    });
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('does nothing for a source left out of the enable list', async () => {
    const result = await prepareScrape({ ...INPUT, source: 'railyatri_scrape' });
    expect(result).toMatchObject({ kind: 'skipped', reason: 'source_off' });
  });

  it('skips a source that needs a slug the train has none of, and reads nothing', async () => {
    const result = await prepareScrape({
      ...INPUT,
      source: 'travelkhana_scrape',
      trainNumber: '12017',
    });
    expect(result).toMatchObject({ kind: 'skipped', reason: 'no_slug' });
    expect(healthFor).not.toHaveBeenCalled();
    expect(fetchPage).not.toHaveBeenCalled();
  });
});

describe('prepareScrape, the circuit and the gate', () => {
  it('waits out an open circuit', async () => {
    let health = HEALTHY;
    for (let count = 0; count < 5; count += 1) {
      health = afterFailure(health, NOW, false);
    }
    vi.mocked(healthFor).mockResolvedValue(health);
    expect(await prepareScrape(INPUT)).toMatchObject({ kind: 'skipped', reason: 'circuit_open' });
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('waits out a block', async () => {
    vi.mocked(blockFor).mockResolvedValue(afterBlock(NOT_BLOCKED, '2026-10-30T03:00:00.000Z'));
    const result = await prepareScrape(INPUT);
    expect(result).toMatchObject({ kind: 'skipped', reason: 'blocked' });
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('holds a fetch that comes inside the minute gap, and says when it may go', async () => {
    vi.mocked(scrapeStateFor).mockResolvedValue({
      lastAnyAt: '2026-10-30T04:39:30.000Z',
      lastUrlAt: null,
      fetchedToday: 1,
    });
    expect(await prepareScrape(INPUT)).toEqual({
      kind: 'skipped',
      reason: 'too_soon',
      readyAt: '2026-10-30T04:40:30.000Z',
    });
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('stops at the daily cap', async () => {
    vi.mocked(scrapeStateFor).mockResolvedValue({
      lastAnyAt: null,
      lastUrlAt: null,
      fetchedToday: 300,
    });
    expect(await prepareScrape(INPUT)).toMatchObject({ kind: 'skipped', reason: 'daily_cap' });
  });
});

describe('prepareScrape, robots.txt', () => {
  it('fetches robots.txt first when none is held, saves it as a row of its own, and fetches no page yet', async () => {
    vi.mocked(robotsFor).mockResolvedValue(null);
    vi.mocked(fetchPage).mockResolvedValue(replied('User-agent: *\nDisallow:'));

    const result = await prepareScrape(INPUT);

    expect(result).toEqual({
      kind: 'skipped',
      reason: 'robots_fetched',
      readyAt: '2026-10-30T04:41:00.000Z',
    });
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchPage).mock.calls[0]?.[1]).toBe('https://www.confirmtkt.com/robots.txt');
    const row = vi.mocked(insertRawFetch).mock.calls[0]?.[0];
    expect(row).toMatchObject({ journey_id: null, source: 'confirmtkt_scrape' });
  });

  it('fetches it again when the held one is an unanswered request more than an hour old', async () => {
    vi.mocked(robotsFor).mockResolvedValue({
      reply: { status: 503, body: '' },
      fetchedAt: '2026-10-30T03:00:00.000Z',
    });
    vi.mocked(fetchPage).mockResolvedValue(replied('', { status: 503 }));
    expect(await prepareScrape(INPUT)).toMatchObject({ reason: 'robots_fetched' });
  });

  it('does not fetch a page robots.txt disallows', async () => {
    vi.mocked(robotsFor).mockResolvedValue({
      reply: { status: 200, body: 'User-agent: *\nDisallow: /' },
      fetchedAt: '2026-10-30T03:00:00.000Z',
    });
    expect(await prepareScrape(INPUT)).toMatchObject({ reason: 'robots_disallowed' });
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('treats a robots.txt that gave no answer a few minutes ago as disallowed', async () => {
    vi.mocked(robotsFor).mockResolvedValue({
      reply: { status: 0, body: '', error: 'timeout' },
      fetchedAt: '2026-10-30T04:30:00.000Z',
    });
    expect(await prepareScrape(INPUT)).toMatchObject({ reason: 'robots_disallowed' });
  });
});

describe('prepareScrape, when everything allows the page', () => {
  it('hands back the page address with the health and block it read, and fetches nothing', async () => {
    const result = await prepareScrape(INPUT);
    expect(result).toEqual({
      kind: 'ready',
      url: 'https://www.confirmtkt.com/train-running-status/12951?Date=29-Oct-2026',
      health: HEALTHY,
      block: NOT_BLOCKED,
    });
    expect(fetchPage).not.toHaveBeenCalled();
    expect(insertRawFetch).not.toHaveBeenCalled();
  });

  it('lets a blocked source through once its wait is over', async () => {
    vi.mocked(blockFor).mockResolvedValue(afterBlock(NOT_BLOCKED, '2026-10-29T04:00:00.000Z'));
    expect(await prepareScrape(INPUT)).toMatchObject({ kind: 'ready' });
  });
});
