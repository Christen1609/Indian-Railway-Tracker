import { describe, expect, it } from 'vitest';
import {
  NOT_BLOCKED,
  afterBlock,
  blockedUntil,
  isBlockedResponse,
  scrapeGate,
} from './scrape-gate.js';
import type { BlockState, GateInput } from './scrape-gate.js';

const NOW = '2026-11-02T10:00:00.000Z';
const SECOND_MS = 1000;

/** The gate input for a fetch with nothing in the way, with the given parts changed */
function open(over: Partial<GateInput> = {}): GateInput {
  return {
    now: NOW,
    block: NOT_BLOCKED,
    lastAnyAt: null,
    lastUrlAt: null,
    fetchedToday: 0,
    dailyCap: 300,
    ...over,
  };
}

/** An instant a number of seconds before NOW */
function secondsAgo(seconds: number): string {
  return new Date(Date.parse(NOW) - seconds * SECOND_MS).toISOString();
}

describe('scrapeGate', () => {
  const CASES: [string, Partial<GateInput>, boolean, string][] = [
    ['nothing fetched yet', {}, true, 'allowed'],
    [
      'the last fetch on any site was 61 seconds ago',
      { lastAnyAt: secondsAgo(61) },
      true,
      'allowed',
    ],
    [
      'the last fetch on any site was exactly 60 seconds ago',
      { lastAnyAt: secondsAgo(60) },
      true,
      'allowed',
    ],
    [
      'the last fetch on any site was 59 seconds ago',
      { lastAnyAt: secondsAgo(59) },
      false,
      'too_soon',
    ],
    [
      'this page was fetched 4 minutes 59 seconds ago, though no other site was',
      { lastAnyAt: secondsAgo(299), lastUrlAt: secondsAgo(299) },
      false,
      'url_too_soon',
    ],
    [
      'this page was fetched 5 minutes ago',
      { lastAnyAt: secondsAgo(300), lastUrlAt: secondsAgo(300) },
      true,
      'allowed',
    ],
    ['today is already at the cap', { fetchedToday: 300 }, false, 'daily_cap'],
    ['today is one under the cap', { fetchedToday: 299 }, true, 'allowed'],
    [
      'the source is blocked and its wait has not passed',
      { block: { blockedAt: secondsAgo(3600), blockCount: 1 } },
      false,
      'blocked',
    ],
  ];

  for (const [name, over, allowed, reason] of CASES) {
    it(`${allowed ? 'allows' : 'refuses'} a fetch when ${name}`, () => {
      const verdict = scrapeGate(open(over));
      expect(verdict.allowed).toBe(allowed);
      expect(verdict.reason).toBe(reason);
    });
  }

  it('says when a fetch held up by the minute gap may go ahead', () => {
    expect(scrapeGate(open({ lastAnyAt: secondsAgo(20) })).readyAt).toBe(
      new Date(Date.parse(NOW) + 40 * SECOND_MS).toISOString(),
    );
  });

  it('waits for the later of the two gaps when both hold it up', () => {
    const verdict = scrapeGate(open({ lastAnyAt: secondsAgo(20), lastUrlAt: secondsAgo(100) }));
    expect(verdict.reason).toBe('too_soon');
    expect(verdict.readyAt).toBe(new Date(Date.parse(NOW) + 200 * SECOND_MS).toISOString());
  });

  it('holds a capped day until midnight IST', () => {
    expect(scrapeGate(open({ fetchedToday: 300 })).readyAt).toBe('2026-11-02T18:30:00.000Z');
  });

  it('lets a blocked source try again once its wait is over, and gives no ready time then', () => {
    const verdict = scrapeGate(
      open({ block: { blockedAt: '2026-11-01T10:00:00.000Z', blockCount: 1 } }),
    );
    expect(verdict).toEqual({ allowed: true, reason: 'allowed', readyAt: null });
  });

  it('puts the block ahead of every other reason', () => {
    const verdict = scrapeGate(
      open({
        block: { blockedAt: secondsAgo(60), blockCount: 1 },
        fetchedToday: 300,
        lastAnyAt: secondsAgo(1),
      }),
    );
    expect(verdict.reason).toBe('blocked');
  });
});

describe('isBlockedResponse', () => {
  const CAPTCHA_PAGE = '<html>Please solve this CAPTCHA to continue</html>';
  const CASES: [string, number, string, boolean, boolean][] = [
    ['a 401', 401, '', false, true],
    ['a 403', 403, 'Forbidden', false, true],
    ['a 451', 451, '', true, true],
    ['a 200 captcha page that could not be read', 200, CAPTCHA_PAGE, true, true],
    ['a 200 page that mentions captcha but read fine', 200, CAPTCHA_PAGE, false, false],
    ['a normal 200', 200, '<html>12951 Running Status</html>', false, false],
    [
      'a 200 page that failed to read without any captcha',
      200,
      '<html>changed</html>',
      true,
      false,
    ],
    ['a 404', 404, 'not found', false, false],
    ['a 429, which opens the circuit instead', 429, '', false, false],
    ['a 503', 503, '', true, false],
    ['a request that never completed', 0, '', true, false],
  ];

  for (const [name, status, body, hasReadFailed, isBlocked] of CASES) {
    it(`${isBlocked ? 'counts' : 'does not count'} ${name} as a block`, () => {
      expect(isBlockedResponse({ status, body, hasReadFailed })).toBe(isBlocked);
    });
  }
});

describe('the blocked state', () => {
  const FIRST: BlockState = afterBlock(NOT_BLOCKED, NOW);

  it('starts unblocked and records when and how often it was blocked', () => {
    expect(NOT_BLOCKED).toEqual({ blockedAt: null, blockCount: 0 });
    expect(FIRST).toEqual({ blockedAt: NOW, blockCount: 1 });
    expect(blockedUntil(NOT_BLOCKED)).toBeNull();
  });

  it('retries after 1 day, then 3, then 7, and stays at 7', () => {
    const waitDays = (state: BlockState): number =>
      (Date.parse(blockedUntil(state) ?? NOW) - Date.parse(NOW)) / (24 * 60 * 60 * SECOND_MS);
    const second = afterBlock(FIRST, NOW);
    const third = afterBlock(second, NOW);
    const fourth = afterBlock(third, NOW);
    expect([FIRST, second, third, fourth].map(waitDays)).toEqual([1, 3, 7, 7]);
  });
});
