// Features: scrape sources, the blocked state and its retry, the politeness gate

import {
  MINUTES_PER_DAY,
  istDateOf,
  plusDays,
  plusMinutes,
  secondsBetween,
  timetableMinuteToUtc,
} from '../time.js';
import type { IsoUtc, SourceId } from '../types.js';

const SITE_GAP_MIN = 1;
const URL_GAP_MIN = 5;
const BLOCK_RETRY_DAYS = [1, 3, 7];
const LONGEST_RETRY_DAYS = 7;
const BLOCKED_STATUSES = [401, 403, 451];
const CAPTCHA = /captcha/i;
const NOT_YET = 0;
const MIDNIGHT = 0;
const ONE_DAY = 1;

export const SCRAPE_SOURCES: readonly SourceId[] = [
  'goibibo_scrape',
  'confirmtkt_scrape',
  'travelkhana_scrape',
  'railyatri_scrape',
  'railmitra_scrape',
];

export type BlockState = { blockedAt: IsoUtc | null; blockCount: number };

export type GateReason = 'allowed' | 'blocked' | 'daily_cap' | 'too_soon' | 'url_too_soon';

export type GateInput = {
  now: IsoUtc;
  block: BlockState;
  lastAnyAt: IsoUtc | null;
  lastUrlAt: IsoUtc | null;
  fetchedToday: number;
  dailyCap: number;
};

export type GateVerdict = { allowed: boolean; reason: GateReason; readyAt: IsoUtc | null };

export const NOT_BLOCKED: BlockState = { blockedAt: null, blockCount: 0 };

/** Whether a response is the site blocking us: a 401, 403 or 451, or a captcha page we could not read */
export function isBlockedResponse(response: {
  status: number;
  body: string;
  hasReadFailed: boolean;
}): boolean {
  return (
    BLOCKED_STATUSES.includes(response.status) ||
    (response.hasReadFailed && CAPTCHA.test(response.body))
  );
}

/** The state after the site blocked us again, one block further along the retry ladder */
export function afterBlock(state: BlockState, at: IsoUtc): BlockState {
  return { blockedAt: at, blockCount: state.blockCount + 1 };
}

/** When a blocked source may be tried again, or null when it is not blocked */
export function blockedUntil(state: BlockState): IsoUtc | null {
  if (state.blockedAt === null) {
    return null;
  }
  const rung = Math.min(state.blockCount, BLOCK_RETRY_DAYS.length) - 1;
  const days = BLOCK_RETRY_DAYS[rung] ?? LONGEST_RETRY_DAYS;
  return plusMinutes(state.blockedAt, days * MINUTES_PER_DAY);
}

/** Whether an instant is still ahead of now, to the second */
function isAhead(at: IsoUtc, now: IsoUtc): boolean {
  return secondsBetween(now, at) > NOT_YET;
}

/** The latest of some instants */
function latest(instants: readonly IsoUtc[]): IsoUtc | null {
  return instants.reduce<IsoUtc | null>(
    (best, at) => (best === null || secondsBetween(best, at) > NOT_YET ? at : best),
    null,
  );
}

/** Whether a scrape fetch may go ahead now, and when it may if not */
export function scrapeGate(input: GateInput): GateVerdict {
  const { now } = input;
  const retryAt = blockedUntil(input.block); // when a block lifts, from blockedUntil
  if (retryAt !== null && isAhead(retryAt, now)) {
    return { allowed: false, reason: 'blocked', readyAt: retryAt };
  }
  if (input.fetchedToday >= input.dailyCap) {
    const tomorrow = plusDays(istDateOf(now), ONE_DAY); // the next IST date, from plusDays
    return {
      allowed: false,
      reason: 'daily_cap',
      readyAt: timetableMinuteToUtc(tomorrow, MIDNIGHT),
    };
  }

  const siteReady = input.lastAnyAt === null ? null : plusMinutes(input.lastAnyAt, SITE_GAP_MIN);
  const urlReady = input.lastUrlAt === null ? null : plusMinutes(input.lastUrlAt, URL_GAP_MIN);
  const waits = [siteReady, urlReady].filter((at): at is IsoUtc => at !== null && isAhead(at, now));
  const readyAt = latest(waits);
  if (readyAt === null) {
    return { allowed: true, reason: 'allowed', readyAt: null };
  }
  const isSiteWait = siteReady !== null && isAhead(siteReady, now);
  return { allowed: false, reason: isSiteWait ? 'too_soon' : 'url_too_soon', readyAt };
}
