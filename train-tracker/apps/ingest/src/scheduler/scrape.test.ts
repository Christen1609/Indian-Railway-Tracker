import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HEALTHY, afterFailure } from '@train-tracker/core/schedule/health';
import { NOT_BLOCKED, afterBlock } from '@train-tracker/core/schedule/scrape-gate';
import { parseConfirmTktLive } from '@train-tracker/core/sources/confirmtkt';
import type { RawFetch } from '@train-tracker/core/types';
import { fetchPage } from '../adapters/scrape.js';
import type { Config } from '../config.js';
import { insertRawFetch, robotsFor, scrapeStateFor } from '../db/raw-fetches.js';
import { blockFor, healthFor, saveBlock, saveHealth } from '../db/source-health.js';
import { classifyRead, prepareScrape, readScrape, settleScrape } from './scrape.js';
import type { ScrapeInput, ScrapeRead } from './scrape.js';

vi.mock('../adapters/scrape.js');
vi.mock('@train-tracker/core/sources/confirmtkt', async (original) => {
  const real = await original<typeof import('@train-tracker/core/sources/confirmtkt')>();
  return { ...real, parseConfirmTktLive: vi.fn(real.parseConfirmTktLive) };
});
vi.mock('../log.js');
vi.mock('../db/source-health.js');
vi.mock('../db/raw-fetches.js', async (original) => ({
  ...(await original<typeof import('../db/raw-fetches.js')>()),
  insertRawFetch: vi.fn(),
  robotsFor: vi.fn(),
  scrapeStateFor: vi.fn(),
}));

const FIXTURES = join(import.meta.dirname, '../../../../fixtures');
const CONFIRMTKT_PAGE = readFileSync(
  join(FIXTURES, 'confirmtkt/12951-2026-10-30T0435IST-date-29oct-running.html'),
  'utf8',
);
const NO_DATA_PAGE = readFileSync(
  join(FIXTURES, 'goibibo/12017-2026-11-02T0905IST-no-data-excerpt.html'),
  'utf8',
);
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

/** The row last stored for a reply */
function storedRow(): Record<string, unknown> {
  return vi.mocked(insertRawFetch).mock.calls[0]?.[0] as unknown as Record<string, unknown>;
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
  vi.mocked(fetchPage).mockResolvedValue(replied(CONFIRMTKT_PAGE));
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

/** What readScrape hands back for a reply, which must be a read */
async function readOf(raw: RawFetch, input: ScrapeInput = INPUT): Promise<ScrapeRead> {
  vi.mocked(fetchPage).mockResolvedValue(raw);
  const result = await readScrape(input);
  if (result.kind !== 'read') {
    throw new Error(`Expected a read, got a skip for ${result.reason}`);
  }
  return result;
}

describe('readScrape, a usable page', () => {
  it('stores the reply and parses its events with the id of the stored row', async () => {
    const read = await readOf(replied(CONFIRMTKT_PAGE));

    expect(read).toMatchObject({ outcome: 'ok', rawFetchId: 'raw-1', source: 'confirmtkt_scrape' });
    expect(storedRow()).toMatchObject({ journey_id: 'j1', status: 200, error: null });
    expect(read.parsed.events.length).toBeGreaterThan(0);
    for (const event of read.parsed.events) {
      expect(event.rawFetchId).toBe('raw-1');
    }
  });

  it('parses the page once, however large it is', async () => {
    await readOf(replied(CONFIRMTKT_PAGE));
    expect(parseConfirmTktLive).toHaveBeenCalledTimes(1);
  });

  it('touches neither health nor the block, which settleScrape does after the events are checked', async () => {
    await readOf(replied(CONFIRMTKT_PAGE));
    expect(saveHealth).not.toHaveBeenCalled();
    expect(saveBlock).not.toHaveBeenCalled();
  });

  it('hands back the health and block it read, for settleScrape', async () => {
    const read = await readOf(replied(CONFIRMTKT_PAGE));
    expect(read.health).toEqual(HEALTHY);
    expect(read.block).toEqual(NOT_BLOCKED);
  });

  it('returns a skip, with nothing stored, when the page may not be fetched', async () => {
    vi.mocked(robotsFor).mockResolvedValue(null);
    vi.mocked(fetchPage).mockResolvedValue(replied('User-agent: *\nDisallow:'));
    expect(await readScrape(INPUT)).toMatchObject({ kind: 'skipped', reason: 'robots_fetched' });
  });
});

describe('readScrape, a reply that is not usable', () => {
  it('stores a page for another run as not successful', async () => {
    const read = await readOf(replied(CONFIRMTKT_PAGE), { ...INPUT, journeyDate: '2026-10-28' });
    expect(read.outcome).toBe('wrong_run');
    expect(storedRow()).toMatchObject({ status: 200, error: 'wrong_run' });
  });

  it('stores a site that answers with no data as unavailable, not a block', async () => {
    const goibibo = { ...INPUT, source: 'goibibo_scrape' } as const;
    const read = await readOf(
      replied(NO_DATA_PAGE, { source: 'goibibo_scrape', url: 'https://www.goibibo.com/x' }),
      goibibo,
    );
    expect(read.outcome).toBe('unavailable');
    expect(storedRow()).toMatchObject({ error: 'unavailable' });
  });

  it('stores a 403 as blocked', async () => {
    const read = await readOf(replied('Forbidden', { status: 403 }));
    expect(read.outcome).toBe('blocked');
    expect(storedRow()).toMatchObject({ status: 403, error: 'blocked' });
  });

  it('calls a captcha page it could not read blocked', async () => {
    const read = await readOf(replied('<html>Please solve the CAPTCHA</html>'));
    expect(read.outcome).toBe('blocked');
  });

  it('does not block on a readable page that merely mentions captcha', async () => {
    const read = await readOf(replied(`${CONFIRMTKT_PAGE}<!-- captcha -->`));
    expect(read.outcome).toBe('ok');
  });

  it('stores a page it cannot read with a parse_error', async () => {
    const read = await readOf(replied('<html>changed</html>'));
    expect(read.outcome).toBe('failed');
    expect(storedRow()).toMatchObject({ error: 'parse_error' });
  });

  it('keeps the error of a request that never completed', async () => {
    const read = await readOf(replied('', { status: 0, error: 'timeout' }));
    expect(read.outcome).toBe('failed');
    expect(storedRow()).toMatchObject({ status: 0, error: 'timeout' });
  });
});

describe('settleScrape, health and the block', () => {
  it('records a success for a usable read with every station code known', async () => {
    const read = await readOf(replied(CONFIRMTKT_PAGE));
    expect(await settleScrape(read, 0, CONFIG, NOW)).toBe('ok');
    expect(vi.mocked(saveHealth).mock.calls[0]?.[1]).toEqual(HEALTHY);
    expect(saveBlock).not.toHaveBeenCalled();
  });

  it('counts one unknown halt as a failed read, which an ok read would not be', async () => {
    const read = await readOf(replied(CONFIRMTKT_PAGE));
    expect(await settleScrape(read, 1, CONFIG, NOW)).toBe('failed');
    expect(vi.mocked(saveHealth).mock.calls[0]?.[1]).toMatchObject({ failures: 1 });
    expect(saveBlock).not.toHaveBeenCalled();
  });

  it('leaves the circuit alone for a page for another run', async () => {
    const read = await readOf(replied(CONFIRMTKT_PAGE), { ...INPUT, journeyDate: '2026-10-28' });
    expect(await settleScrape(read, 0, CONFIG, NOW)).toBe('wrong_run');
    expect(saveHealth).not.toHaveBeenCalled();
    expect(saveBlock).not.toHaveBeenCalled();
  });

  it('counts a site with no data toward the circuit, without a block', async () => {
    const goibibo = { ...INPUT, source: 'goibibo_scrape' } as const;
    const read = await readOf(
      replied(NO_DATA_PAGE, { source: 'goibibo_scrape', url: 'https://www.goibibo.com/x' }),
      goibibo,
    );
    expect(await settleScrape(read, 0, CONFIG, NOW)).toBe('unavailable');
    expect(vi.mocked(saveHealth).mock.calls[0]?.[1]).toMatchObject({ failures: 1 });
    expect(saveBlock).not.toHaveBeenCalled();
  });

  it('moves a source to blocked on a 403, counting it a failure too', async () => {
    const read = await readOf(replied('Forbidden', { status: 403 }));
    expect(await settleScrape(read, 0, CONFIG, NOW)).toBe('blocked');
    expect(saveBlock).toHaveBeenCalledWith(
      'confirmtkt_scrape',
      { blockedAt: NOW, blockCount: 1 },
      NOW,
      CONFIG.db,
    );
    expect(vi.mocked(saveHealth).mock.calls[0]?.[1]).toMatchObject({ failures: 1 });
  });

  it('lifts a block when the read works', async () => {
    vi.mocked(blockFor).mockResolvedValue(afterBlock(NOT_BLOCKED, '2026-10-29T04:00:00.000Z'));
    const read = await readOf(replied(CONFIRMTKT_PAGE));
    await settleScrape(read, 0, CONFIG, NOW);
    expect(saveBlock).toHaveBeenCalledWith('confirmtkt_scrape', NOT_BLOCKED, NOW, CONFIG.db);
  });

  it('does not lift a block when the read had an unknown halt', async () => {
    vi.mocked(blockFor).mockResolvedValue(afterBlock(NOT_BLOCKED, '2026-10-29T04:00:00.000Z'));
    const read = await readOf(replied(CONFIRMTKT_PAGE));
    await settleScrape(read, 2, CONFIG, NOW);
    expect(saveBlock).not.toHaveBeenCalled();
  });

  it('counts a page it could not read as a failure', async () => {
    const read = await readOf(replied('<html>changed</html>'));
    expect(await settleScrape(read, 0, CONFIG, NOW)).toBe('failed');
    expect(vi.mocked(saveHealth).mock.calls[0]?.[1]).toMatchObject({ failures: 1 });
  });
});

describe('classifyRead', () => {
  it('checks unavailable before wrong run', () => {
    const page = replied(NO_DATA_PAGE);
    const parsed = { events: [], errors: [], journeyDate: null, isUnavailable: true };
    expect(classifyRead(page, parsed, RUN).outcome).toBe('unavailable');
  });

  it('calls a page for another run wrong_run only when it read fine', () => {
    const page = replied(CONFIRMTKT_PAGE);
    const parsed = parseConfirmTktLive(page, 'raw-1');
    expect(classifyRead(page, parsed, '2026-10-28').outcome).toBe('wrong_run');
    expect(classifyRead(page, parsed, RUN).outcome).toBe('ok');
  });
});
