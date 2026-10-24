import { describe, expect, it } from 'vitest';
import { rawFetchRow } from './raw-fetches.js';
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
