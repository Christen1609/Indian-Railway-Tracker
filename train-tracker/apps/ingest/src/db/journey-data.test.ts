import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearBodiesFor, journeyStatusOn } from './journey-data.js';

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

describe('journeyStatusOn', () => {
  const reply = (rows: unknown) => new Response(JSON.stringify(rows), { status: 200 });

  /** Serves the journey row, then the state row if the call asks for one */
  function serves(journey: unknown[], state: unknown[] = []): ReturnType<typeof vi.fn> {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(journey))
      .mockResolvedValueOnce(reply(state));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('is null when the run was never started', async () => {
    serves([]);
    expect(await journeyStatusOn('12951', '2026-10-29', CONFIG)).toBeNull();
  });

  it('is arrived once the state says so, though the journey is only marked when swept', async () => {
    serves([{ id: 'j1', status: 'scheduled' }], [{ state: 'arrived' }]);
    expect(await journeyStatusOn('12951', '2026-10-29', CONFIG)).toBe('arrived');
  });

  it.each(['arrived', 'cancelled'] as const)(
    'takes %s from the journey and reads no state',
    async (status) => {
      const fetchMock = serves([{ id: 'j1', status }]);
      expect(await journeyStatusOn('12951', '2026-10-29', CONFIG)).toBe(status);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps the journey status while the state is still running', async () => {
    serves([{ id: 'j1', status: 'running' }], [{ state: 'late' }]);
    expect(await journeyStatusOn('12951', '2026-10-29', CONFIG)).toBe('running');
  });

  it('keeps the journey status when no state was written yet', async () => {
    serves([{ id: 'j1', status: 'scheduled' }], []);
    expect(await journeyStatusOn('12951', '2026-10-29', CONFIG)).toBe('scheduled');
  });

  it('looks the run up by train and date', async () => {
    const fetchMock = serves([]);
    await journeyStatusOn('12951', '2026-10-29', CONFIG);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://db/rest/v1/journeys?train_number=eq.12951&journey_date=eq.2026-10-29&select=id,status',
    );
  });
});
