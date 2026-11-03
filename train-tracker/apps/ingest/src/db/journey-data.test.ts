import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearBodiesFor } from './journey-data.js';

const CONFIG = { url: 'http://db', serviceRoleKey: 'k' };
const JOURNEY = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('clearBodiesFor', () => {
  it('blanks the bodies of one journey with a patch, and deletes no row', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await clearBodiesFor(JOURNEY, CONFIG);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe(`http://db/rest/v1/raw_fetches?journey_id=eq.${JOURNEY}`);
    expect(options.method).toBe('PATCH');
    expect(JSON.parse(options.body)).toEqual({ body: null });
  });

  it('changes nothing but the body, so the source, time and status still count the calls made', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await clearBodiesFor(JOURNEY, CONFIG);
    const options = fetchMock.mock.calls[0]?.[1] as { body: string };
    expect(Object.keys(JSON.parse(options.body) as object)).toEqual(['body']);
  });

  it('fails loudly when the database refuses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no', { status: 500 })));
    await expect(clearBodiesFor(JOURNEY, CONFIG)).rejects.toThrow(/Patch of raw_fetches/);
  });
});
