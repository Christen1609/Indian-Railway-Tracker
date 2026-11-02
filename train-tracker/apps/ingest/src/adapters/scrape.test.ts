import { afterEach, describe, expect, it, vi } from 'vitest';
import { USER_AGENT, fetchPage } from './scrape.js';

const URL_TO_FETCH = 'https://www.railyatri.in/live-train-status/12017';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchPage', () => {
  it('returns the status and body of a reply, and sends an honest User-Agent naming the repo', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('<html>ok</html>', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const raw = await fetchPage('railyatri_scrape', URL_TO_FETCH);

    expect(raw).toMatchObject({
      source: 'railyatri_scrape',
      url: URL_TO_FETCH,
      status: 200,
      body: '<html>ok</html>',
    });
    expect(raw.error).toBeUndefined();
    const options = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(options.headers['user-agent']).toBe(USER_AGENT);
    expect(USER_AGENT).toContain('train-tracker');
    expect(USER_AGENT).toContain('https://github.com/');
  });

  it('gives the request a 30 second limit', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const timeout = vi.spyOn(AbortSignal, 'timeout');

    await fetchPage('goibibo_scrape', URL_TO_FETCH);

    expect(timeout).toHaveBeenCalledWith(30_000);
  });

  it('keeps the body of a bad status as it came, without an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Forbidden', { status: 403 })));
    const raw = await fetchPage('goibibo_scrape', URL_TO_FETCH);
    expect(raw.status).toBe(403);
    expect(raw.body).toBe('Forbidden');
    expect(raw.error).toBeUndefined();
  });

  it('returns an error and status 0 when the request never completes, without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('The operation was aborted')));
    const raw = await fetchPage('goibibo_scrape', URL_TO_FETCH);
    expect(raw).toMatchObject({ status: 0, body: '', error: 'The operation was aborted' });
  });

  it('returns an error when the failure is not an Error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('boom'));
    expect((await fetchPage('goibibo_scrape', URL_TO_FETCH)).error).toBe('boom');
  });
});
