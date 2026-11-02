import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { robotsAllow, robotsDue } from './robots.js';

const NOW = '2026-11-02T10:00:00.000Z';
const URL_ON_SITE = 'https://www.goibibo.com/trains/live-train-status/12951-running-status/';

describe('robotsDue', () => {
  const HOUR_MS = 3_600_000;
  const DAY_MS = 24 * HOUR_MS;
  const agoMs = (ms: number): string => new Date(Date.parse(NOW) - ms).toISOString();
  const REPLIES: [string, { status: number; body: string; error?: string }, number][] = [
    ['a 200', { status: 200, body: '' }, DAY_MS],
    ['a 404, which means no restrictions', { status: 404, body: '' }, DAY_MS],
    ['a 401, which is a clear answer', { status: 401, body: '' }, DAY_MS],
    ['a 403, which is a clear answer', { status: 403, body: '' }, DAY_MS],
    ['a 500', { status: 500, body: '' }, HOUR_MS],
    ['a 503', { status: 503, body: '' }, HOUR_MS],
    [
      'a timeout',
      { status: 0, body: '', error: 'The operation was aborted due to timeout' },
      HOUR_MS,
    ],
    ['a request that never completed', { status: 0, body: '' }, HOUR_MS],
  ];

  it('is due when robots.txt was never fetched', () => {
    expect(robotsDue(null, NOW)).toBe(true);
  });

  for (const [name, reply, keptMs] of REPLIES) {
    it(`keeps ${name} for ${keptMs / HOUR_MS} hours, to the second`, () => {
      expect(robotsDue({ reply, fetchedAt: agoMs(keptMs - 1000) }, NOW)).toBe(false);
      expect(robotsDue({ reply, fetchedAt: agoMs(keptMs) }, NOW)).toBe(true);
    });
  }
});

describe('robotsAllow', () => {
  const ok = (body: string) => ({ status: 200, body });
  const CASES: [string, { status: number; body: string; error?: string }, boolean][] = [
    ['no rules at all', ok(''), true],
    ['everything disallowed for every agent', ok('User-agent: *\nDisallow: /'), false],
    ['an empty Disallow, which allows everything', ok('User-agent: *\nDisallow:'), true],
    ['another path disallowed', ok('User-agent: *\nDisallow: /admin'), true],
    ['a prefix of this path disallowed', ok('User-agent: *\nDisallow: /trains/'), false],
    [
      'a disallowed prefix with a longer Allow for this path',
      ok('User-agent: *\nDisallow: /trains/\nAllow: /trains/live-train-status/'),
      true,
    ],
    ['a wildcard that matches', ok('User-agent: *\nDisallow: /trains/*/12951-*'), false],
    ['an end anchor that does not match', ok('User-agent: *\nDisallow: /trains/$'), true],
    [
      'a group for this project that allows it, and one for all that does not',
      ok('User-agent: *\nDisallow: /\n\nUser-agent: train-tracker\nDisallow:'),
      true,
    ],
    ['comments and blank lines', ok('# hello\n\nUser-agent: * # all\nDisallow: / # none'), false],
    ['rules for another agent only', ok('User-agent: Googlebot\nDisallow: /'), true],
    [
      'two agent lines sharing one group',
      ok('User-agent: Bingbot\nUser-agent: *\nDisallow: /'),
      false,
    ],
    ['a 404, which means no restrictions', { status: 404, body: 'not found' }, true],
    ['a 403', { status: 403, body: 'Forbidden' }, false],
    ['a 401', { status: 401, body: '' }, false],
    ['a 500', { status: 500, body: '' }, false],
    ['a 503', { status: 503, body: '' }, false],
    ['a timeout', { status: 0, body: '', error: 'The operation was aborted' }, false],
  ];

  for (const [name, reply, isAllowed] of CASES) {
    it(`${isAllowed ? 'allows' : 'refuses'} the page for ${name}`, () => {
      expect(robotsAllow(reply, URL_ON_SITE)).toBe(isAllowed);
    });
  }

  it('reads the query string as part of the path', () => {
    const reply = ok('User-agent: *\nDisallow: /train-running-status/12951?Date=');
    const url = 'https://www.confirmtkt.com/train-running-status/12951?Date=01-Nov-2026';
    expect(robotsAllow(reply, url)).toBe(false);
  });
});

describe('robotsAllow on the real robots.txt of each site, fetched 2 Nov 2026', () => {
  const FIXTURES = join(import.meta.dirname, '../../../../fixtures/robots');
  const real = (name: string, status: number) => ({
    status,
    body: readFileSync(join(FIXTURES, name), 'utf8'),
  });
  const CONFIRMTKT = real('www.confirmtkt.com-2026-11-02T1208IST-status200.txt', 200);
  const TRAVELKHANA = real('www.travelkhana.com-2026-11-02T1209IST-status200.txt', 200);
  const RAILYATRI = real('www.railyatri.in-2026-11-02T1210IST-status200.txt', 200);
  const RAILMITRA = real('www.railmitra.com-2026-11-02T1211IST-status503.txt', 503);

  const CASES: [string, typeof CONFIRMTKT, string, boolean][] = [
    [
      'ConfirmTkt allows the running status page we fetch',
      CONFIRMTKT,
      'https://www.confirmtkt.com/train-running-status/12951?Date=01-Nov-2026',
      true,
    ],
    [
      'ConfirmTkt refuses a path its file disallows',
      CONFIRMTKT,
      'https://www.confirmtkt.com/pnr-status/1234567890',
      false,
    ],
    [
      'Travelkhana allows the track-train page we fetch',
      TRAVELKHANA,
      'https://www.travelkhana.com/travelkhana/track-train/12951-Mumbai-Central---New-Delhi-Tejas-Rajdhani-Express',
      true,
    ],
    [
      'Travelkhana refuses a path its file disallows',
      TRAVELKHANA,
      'https://www.travelkhana.com/payment/start',
      false,
    ],
    [
      'RailYatri allows the live status page we fetch',
      RAILYATRI,
      'https://www.railyatri.in/live-train-status/12017',
      true,
    ],
    [
      'RailYatri refuses a path its file disallows, with a wildcard',
      RAILYATRI,
      'https://www.railyatri.in/12756069/anything',
      false,
    ],
    [
      'Railmitra, whose robots.txt answered 503, is treated as disallowed',
      RAILMITRA,
      'https://www.railmitra.com/live-train-running-status/mumbai-rajdhani-12951?day=yesterday',
      false,
    ],
  ];

  for (const [name, reply, url, isAllowed] of CASES) {
    it(name, () => {
      expect(robotsAllow(reply, url)).toBe(isAllowed);
    });
  }
});
