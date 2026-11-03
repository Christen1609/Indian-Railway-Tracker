import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IssueDraft } from '@train-tracker/core/schedule/issue';
import { openIssue } from './issues.js';

vi.mock('../log.js');

const NOW = '2026-11-03T10:00:00.000Z';
const ISSUES = { token: 'secret-token', repository: 'owner/repo' };
const DRAFT: IssueDraft = {
  title: 'Parser fix: goibibo_scrape failed read',
  body: 'body',
  labels: ['worker', 'parser-fix'],
};

const fetchMock = vi.fn();

/** A JSON reply from GitHub */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** The issues GitHub lists, one title each, created this morning */
function listed(titles: string[]): Response {
  return json(titles.map((title) => ({ title, created_at: '2026-11-03T01:00:00Z' })));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('openIssue', () => {
  it('does nothing, without a call, when there is no token and repository', async () => {
    expect(await openIssue(DRAFT, null, NOW)).toBe('off');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('opens the issue with its labels when nothing like it is open', async () => {
    fetchMock
      .mockResolvedValueOnce(listed([]))
      .mockResolvedValueOnce(listed([]))
      .mockResolvedValueOnce(json({}, 201));

    expect(await openIssue(DRAFT, ISSUES, NOW)).toBe('opened');

    const [url, init] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/owner/repo/issues');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(DRAFT);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret-token');
  });

  it('opens nothing when an issue with the same title is open', async () => {
    fetchMock.mockResolvedValueOnce(listed(['Other', DRAFT.title]));
    expect(await openIssue(DRAFT, ISSUES, NOW)).toBe('duplicate');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('opens nothing once five were opened today', async () => {
    fetchMock
      .mockResolvedValueOnce(listed([]))
      .mockResolvedValueOnce(listed(['a', 'b', 'c', 'd', 'e']));
    expect(await openIssue(DRAFT, ISSUES, NOW)).toBe('capped');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not count an issue opened before today', async () => {
    const old = json(
      ['a', 'b', 'c', 'd', 'e'].map((title) => ({ title, created_at: '2026-11-02T23:59:59Z' })),
    );
    fetchMock
      .mockResolvedValueOnce(listed([]))
      .mockResolvedValueOnce(old)
      .mockResolvedValueOnce(json({}, 201));
    expect(await openIssue(DRAFT, ISSUES, NOW)).toBe('opened');
  });

  it.each([
    ['GitHub refuses', () => fetchMock.mockResolvedValue(json({}, 403))],
    ['the network is down', () => fetchMock.mockRejectedValue(new Error('offline'))],
    ['the reply is not a list', () => fetchMock.mockResolvedValue(json({ message: 'x' }))],
  ])('never throws when %s', async (_name, arrange) => {
    arrange();
    expect(await openIssue(DRAFT, ISSUES, NOW)).toBe('error');
  });
});
