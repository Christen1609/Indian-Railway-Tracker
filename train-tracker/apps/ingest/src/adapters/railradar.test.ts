import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchRailRadarLive } from './railradar.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchRailRadarLive', () => {
  it('passes an abort signal to fetch', async () => {
    const stub = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', stub);
    await fetchRailRadarLive('12951', 'key');
    const options = stub.mock.calls[0]?.[1] as RequestInit;
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('turns a rejected fetch into a RawFetch with an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timed out')));
    const raw = await fetchRailRadarLive('12951', 'key');
    expect(raw).toMatchObject({ status: 0, body: '', error: 'timed out' });
  });
});
