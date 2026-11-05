import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  lastRailRadarAt,
  railRadarCallsFor,
  railRadarQueries,
  rawFetchRow,
  scrapeStateQueries,
  triedOutcome,
  triedQuery,
  triedSince,
} from './raw-fetches.js';
import type { RawFetch } from '@train-tracker/core/types';

const JOURNEY = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

/** A RawFetch as the adapter hands it over */
function fetched(over: Partial<RawFetch> = {}): RawFetch {
  return {
    source: 'railradar',
    url: 'https://api.railradar.in/v1/trains/12951/live',
    status: 200,
    body: '{"success":true}',
    fetchedAt: '2026-10-22T03:05:26.000Z',
    latencyMs: 858,
    ...over,
  };
}

describe('rawFetchRow', () => {
  it('records status, latency and the body of a good response', () => {
    expect(rawFetchRow(fetched(), JOURNEY)).toEqual({
      journey_id: JOURNEY,
      source: 'railradar',
      url: 'https://api.railradar.in/v1/trains/12951/live',
      status: 200,
      body: '{"success":true}',
      error: null,
      fetched_at: '2026-10-22T03:05:26.000Z',
      latency_ms: 858,
    });
  });

  it('still builds a row when the request never completed', () => {
    const row = rawFetchRow(
      fetched({ status: 0, body: '', error: 'getaddrinfo ENOTFOUND' }),
      JOURNEY,
    );
    expect(row.status).toBe(0);
    expect(row.error).toBe('getaddrinfo ENOTFOUND');
    expect(row.body).toBeNull();
    expect(row.latency_ms).toBe(858);
  });

  it('still builds a row for a malformed body, keeping it exactly as it came', () => {
    const row = rawFetchRow(fetched({ status: 502, body: '<html>502</html>' }), JOURNEY);
    expect(row.status).toBe(502);
    expect(row.body).toBe('<html>502</html>');
    expect(row.error).toBeNull();
  });

  it('takes a null journey id for a snapshot call', () => {
    expect(
      rawFetchRow(fetched({ url: 'https://api.railradar.in/v1/legacy/trains/live-map' }), null)
        .journey_id,
    ).toBeNull();
  });

  it('never carries an undefined, which would drop the column from the insert', () => {
    for (const value of Object.values(rawFetchRow(fetched({ body: '', status: 0 }), null))) {
      expect(value).not.toBeUndefined();
    }
  });
});

describe('scrapeStateQueries', () => {
  const queries = scrapeStateQueries(
    'https://www.confirmtkt.com/train-running-status/12951?Date=01-Nov-2026',
    '2026-11-02T10:00:00.000Z',
  );

  it('looks only at the five scrape sources, never RailRadar', () => {
    for (const query of Object.values(queries)) {
      expect(query).toContain(
        'source=in.(goibibo_scrape,confirmtkt_scrape,travelkhana_scrape,railyatri_scrape,railmitra_scrape)',
      );
      expect(query).not.toContain('railradar');
    }
  });

  it('asks for the newest fetch overall and the newest of one page, URL encoded', () => {
    expect(queries.lastAny).toContain('order=fetched_at.desc&limit=1');
    expect(queries.lastUrl).toContain(
      'url=eq.https%3A%2F%2Fwww.confirmtkt.com%2Ftrain-running-status%2F12951%3FDate%3D01-Nov-2026',
    );
  });

  it('counts from midnight IST, which is 18:30 UTC the evening before', () => {
    expect(queries.today).toContain('fetched_at=gte.2026-11-01T18%3A30%3A00.000Z');
  });
});

describe('triedOutcome', () => {
  const CASES: [string, number, string | null, string][] = [
    ['a clean 200', 200, null, 'ok'],
    ['a page for another run', 200, 'wrong_run', 'wrong_run'],
    ['a site with no data', 200, 'unavailable', 'unavailable'],
    ['a block', 403, 'blocked', 'blocked'],
    ['a captcha page read as a block', 200, 'blocked', 'blocked'],
    ['a page that could not be read', 200, 'parse_error', 'failed'],
    ['a request that timed out', 0, 'The operation was aborted due to timeout', 'failed'],
    ['a bad status with no error text', 500, null, 'failed'],
  ];

  it.each(CASES)('reads %s as %s', (_name, status, error, expected) => {
    expect(triedOutcome({ status, error })).toBe(expected);
  });
});

describe('triedQuery', () => {
  const query = triedQuery('j1', '2026-10-30T04:40:00.000Z');

  it('is scoped to one journey, so robots.txt rows, which have none, never count as tried', () => {
    expect(query).toContain('journey_id=eq.j1');
  });

  it('looks only at the five scrape sources, since the check was due, oldest first', () => {
    expect(query).toContain(
      'source=in.(goibibo_scrape,confirmtkt_scrape,travelkhana_scrape,railyatri_scrape,railmitra_scrape)',
    );
    expect(query).toContain('fetched_at=gte.2026-10-30T04%3A40%3A00.000Z');
    expect(query).toContain('order=fetched_at.asc,id.asc');
    expect(query).not.toContain('railradar');
  });

  it('encodes a database timestamp with an offset, so its plus sign is not read as a space', () => {
    const fromDb = triedQuery('j1', '2026-11-04T11:53:09.193+00:00');
    expect(fromDb).toContain('fetched_at=gte.2026-11-04T11%3A53%3A09.193%2B00%3A00');
  });
});

describe('triedSince', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('turns the rows of this check into a tried list, in the order they were read', async () => {
    const rows = [
      {
        source: 'confirmtkt_scrape',
        status: 200,
        error: null,
        fetched_at: '2026-10-30T04:40:05.000Z',
      },
      {
        source: 'railyatri_scrape',
        status: 200,
        error: 'wrong_run',
        fetched_at: '2026-10-30T04:41:10.000Z',
      },
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(rows), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const tried = await triedSince('j1', '2026-10-30T04:40:00.000Z', {
      url: 'http://db',
      serviceRoleKey: 'k',
    });

    expect(tried).toEqual([
      { source: 'confirmtkt_scrape', outcome: 'ok' },
      { source: 'railyatri_scrape', outcome: 'wrong_run' },
    ]);
    const asked = fetchMock.mock.calls[0]?.[0] as string;
    expect(asked).toContain('journey_id=eq.j1');
  });
});

describe('railRadarQueries', () => {
  const queries = railRadarQueries('j1');

  it('counts the RailRadar rows of one journey, kept even after their bodies are cleared', () => {
    expect(queries.calls).toBe('raw_fetches?journey_id=eq.j1&source=eq.railradar');
  });

  it('asks for the newest RailRadar row of one journey', () => {
    expect(queries.last).toBe(
      'raw_fetches?journey_id=eq.j1&source=eq.railradar&select=fetched_at&order=fetched_at.desc&limit=1',
    );
  });
});

describe('lastRailRadarAt and railRadarCallsFor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const CONFIG = { url: 'http://db', serviceRoleKey: 'k' };

  it('gives the time of the newest RailRadar row, or null when there is none', async () => {
    const reply = (rows: unknown) => new Response(JSON.stringify(rows), { status: 200 });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(reply([{ fetched_at: '2026-10-30T04:40:00.000Z' }]))
        .mockResolvedValueOnce(reply([])),
    );
    expect(await lastRailRadarAt('j1', CONFIG)).toBe('2026-10-30T04:40:00.000Z');
    expect(await lastRailRadarAt('j1', CONFIG)).toBeNull();
  });

  it('counts the RailRadar rows of a journey', async () => {
    const reply = new Response(null, { status: 200, headers: { 'content-range': '0-0/4' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply));
    expect(await railRadarCallsFor('j1', CONFIG)).toBe(4);
  });
});
