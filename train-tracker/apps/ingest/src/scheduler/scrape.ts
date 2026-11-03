// Features: what stands in front of a scrape source's page, reading one source for a journey, settling the source's health afterwards

import {
  afterFailure,
  afterSuccess,
  callVerdict,
  sourceUsable,
} from '@train-tracker/core/schedule/health';
import type { CallResult, HealthVerdict, SourceHealth } from '@train-tracker/core/schedule/health';
import { robotsAllow, robotsDue } from '@train-tracker/core/schedule/robots';
import {
  NOT_BLOCKED,
  afterBlock,
  isBlockedResponse,
  scrapeGate,
} from '@train-tracker/core/schedule/scrape-gate';
import type { BlockState, GateReason } from '@train-tracker/core/schedule/scrape-gate';
import { confirmtktTrainData, parseConfirmTktLive } from '@train-tracker/core/sources/confirmtkt';
import { goibiboTrainData, parseGoibiboLive } from '@train-tracker/core/sources/goibibo';
import { parseRailYatriLive, railyatriTrainData } from '@train-tracker/core/sources/railyatri';
import { parseRailmitraLive, railmitraTrainData } from '@train-tracker/core/sources/railmitra';
import type { ParseResult } from '@train-tracker/core/sources/railradar';
import {
  parseTravelkhanaLive,
  travelkhanaTrainData,
} from '@train-tracker/core/sources/travelkhana';
import { istDateOf, plusMinutes } from '@train-tracker/core/time';
import type { IsoDate, IsoUtc, RawFetch } from '@train-tracker/core/types';
import { fetchPage } from '../adapters/scrape.js';
import { scrapeUrl } from '../adapters/scrape-sites.js';
import type { ScrapeSource, SkipReason } from '../adapters/scrape-sites.js';
import type { Config } from '../config.js';
import { insertRawFetch, rawFetchRow, robotsFor, scrapeStateFor } from '../db/raw-fetches.js';
import { blockFor, healthFor, saveBlock, saveHealth } from '../db/source-health.js';
import { log } from '../log.js';

const OK = 200;
const NO_UNKNOWN_HALTS = 0;
const NEXT_REQUEST_MIN = 1;
const ORIGIN = /^(https?:\/\/[^/]+)/;

export type ScrapeSkip =
  | 'disabled'
  | 'source_off'
  | SkipReason
  | Exclude<HealthVerdict['reason'], 'ok'>
  | Exclude<GateReason, 'allowed'>
  | 'robots_fetched'
  | 'robots_disallowed';

export type ScrapeInput = {
  source: ScrapeSource;
  trainNumber: string;
  journeyDate: IsoDate;
  journeyId: string | null;
  config: Config;
  now: IsoUtc;
};

export type ReadOutcome = 'ok' | 'wrong_run' | 'unavailable' | 'blocked' | 'failed';

export type ScrapeReady =
  | { kind: 'skipped'; reason: ScrapeSkip; readyAt: IsoUtc | null }
  | { kind: 'ready'; url: string; health: SourceHealth; block: BlockState };

/** Everything that must allow a scrape before its page is fetched, or the reason it does not */
export async function prepareScrape(input: ScrapeInput): Promise<ScrapeReady> {
  const { source, trainNumber, journeyDate, config, now } = input;
  const skipped = (reason: ScrapeSkip, readyAt: IsoUtc | null = null): ScrapeReady => {
    log('info', 'scrape_skipped', { source, trainNumber, journeyDate, reason, readyAt });
    return { kind: 'skipped', reason, readyAt };
  };

  if (!config.scrape.isEnabled) {
    return skipped('disabled');
  }
  if (!config.scrape.sources.includes(source)) {
    return skipped('source_off');
  }
  // the page address, from scrapeUrl
  const site = scrapeUrl(
    source,
    trainNumber,
    journeyDate,
    config.scrape.slugs[trainNumber],
    istDateOf(now),
  );
  if ('skip' in site) {
    return skipped(site.skip);
  }

  const robotsUrl = `${ORIGIN.exec(site.url)?.[1] ?? ''}/robots.txt`;
  const [health, block, state, robots] = await Promise.all([
    healthFor(source, config.db), // how the source has behaved, from healthFor
    blockFor(source, config.db), // whether the site blocked us, from blockFor
    scrapeStateFor(site.url, now, config.db), // what the scrape sites were last asked, from scrapeStateFor
    robotsFor(robotsUrl, config.db), // the robots.txt we hold, from robotsFor
  ]);
  const usable = sourceUsable(health, now); // whether the circuit is closed, from sourceUsable
  if (!usable.usable && usable.reason !== 'ok') {
    return skipped(usable.reason, usable.readyAt);
  }

  const gate = scrapeGate({ now, block, ...state, dailyCap: config.scrape.dailyCap }); // whether a fetch may go ahead, from scrapeGate
  if (!gate.allowed) {
    return skipped(gate.reason === 'allowed' ? 'too_soon' : gate.reason, gate.readyAt);
  }

  if (robotsDue(robots, now)) {
    const reply = await fetchPage(source, robotsUrl); // robots.txt, from fetchPage
    await insertRawFetch(rawFetchRow(reply, null), config.db);
    return skipped('robots_fetched', plusMinutes(now, NEXT_REQUEST_MIN));
  }
  if (robots === null || !robotsAllow(robots.reply, site.url)) {
    return skipped('robots_disallowed');
  }

  return { kind: 'ready', url: site.url, health, block };
}

export type ScrapeRead = {
  kind: 'read';
  source: ScrapeSource;
  outcome: ReadOutcome;
  raw: RawFetch;
  rawFetchId: string;
  parsed: ParseResult;
  call: Omit<CallResult, 'unknownHalts'>;
  health: SourceHealth;
  block: BlockState;
};

export type ScrapeResult = Extract<ScrapeReady, { kind: 'skipped' }> | ScrapeRead;

const ROW_ERROR: Partial<Record<ReadOutcome, string>> = {
  wrong_run: 'wrong_run',
  unavailable: 'unavailable',
  blocked: 'blocked',
};

/** The events and run date a source's page holds */
function parseScrape(
  source: ScrapeSource,
  raw: RawFetch,
  rawFetchId: string,
  journeyDate: IsoDate,
): ParseResult {
  switch (source) {
    case 'goibibo_scrape':
      return parseGoibiboLive(raw, rawFetchId);
    case 'confirmtkt_scrape':
      return parseConfirmTktLive(raw, rawFetchId);
    case 'travelkhana_scrape':
      return parseTravelkhanaLive(raw, rawFetchId, journeyDate);
    case 'railyatri_scrape':
      return parseRailYatriLive(raw, rawFetchId);
    case 'railmitra_scrape':
      return parseRailmitraLive(raw, rawFetchId);
  }
}

/** What a reply was before its station codes are checked, and what it says about the source */
export function classifyRead(
  raw: RawFetch,
  parsed: ParseResult,
  journeyDate: IsoDate,
): { outcome: ReadOutcome; call: ScrapeRead['call'] } {
  const isUnavailable = parsed.isUnavailable === true;
  const hasReadFailed = raw.error !== undefined || raw.status !== OK || parsed.errors.length > 0;
  const isWrongRun = !isUnavailable && !hasReadFailed && parsed.journeyDate !== journeyDate;
  const call = {
    status: raw.status,
    hasError: raw.error !== undefined,
    parseErrors: parsed.errors.length,
    isWrongRun,
    isUnavailable,
  };
  if (isBlockedResponse({ status: raw.status, body: raw.body, hasReadFailed })) {
    return { outcome: 'blocked', call };
  }
  if (isUnavailable) {
    return { outcome: 'unavailable', call };
  }
  if (isWrongRun) {
    return { outcome: 'wrong_run', call };
  }
  // whether this counts against the source, from callVerdict
  const verdict = callVerdict({ ...call, unknownHalts: NO_UNKNOWN_HALTS });
  return { outcome: verdict.failed ? 'failed' : 'ok', call };
}

/** The part of a source's page worth keeping, or null when it has none */
function trainDataOf(source: ScrapeSource, body: string): string | null {
  switch (source) {
    case 'goibibo_scrape':
      return goibiboTrainData(body);
    case 'confirmtkt_scrape':
      return confirmtktTrainData(body);
    case 'travelkhana_scrape':
      return travelkhanaTrainData(body);
    case 'railyatri_scrape':
      return railyatriTrainData(body);
    case 'railmitra_scrape':
      return railmitraTrainData(body);
  }
}

/** The reply as it is stored: marked as not a success unless usable, cut to its train data unless the read failed */
function storedAs(
  source: ScrapeSource,
  raw: RawFetch,
  outcome: ReadOutcome,
  parseErrors: number,
): RawFetch {
  const error = raw.error ?? ROW_ERROR[outcome] ?? (parseErrors > 0 ? 'parse_error' : undefined);
  const hasReadFailed = raw.error !== undefined || raw.status !== OK || parseErrors > 0;
  const kept = hasReadFailed ? null : trainDataOf(source, raw.body); // the part worth keeping, from trainDataOf
  const stored = kept === null ? raw : { ...raw, body: kept };
  return error === undefined ? stored : { ...stored, error };
}

/** Fetches one scrape source for a journey and stores the reply, leaving health for settleScrape */
export async function readScrape(input: ScrapeInput): Promise<ScrapeResult> {
  const { source, journeyDate, config } = input;
  const ready = await prepareScrape(input); // whether the page may be fetched, from prepareScrape
  if (ready.kind === 'skipped') {
    return ready;
  }

  const raw = await fetchPage(source, ready.url); // the page, from fetchPage
  const parsed = parseScrape(source, raw, '', journeyDate); // events and the run, from parseScrape
  const { outcome, call } = classifyRead(raw, parsed, journeyDate); // what the reply was, from classifyRead
  const rawFetchId = await insertRawFetch(
    rawFetchRow(storedAs(source, raw, outcome, parsed.errors.length), input.journeyId),
    config.db,
  );

  return {
    kind: 'read',
    source,
    outcome,
    raw,
    rawFetchId,
    parsed: { ...parsed, events: parsed.events.map((event) => ({ ...event, rawFetchId })) },
    call,
    health: ready.health,
    block: ready.block,
  };
}

/** Records how a read went for the source, once its station codes are checked: health, then the block */
export async function settleScrape(
  read: ScrapeRead,
  unknownHalts: number,
  config: Config,
  now: IsoUtc,
): Promise<ReadOutcome> {
  const verdict = callVerdict({ ...read.call, unknownHalts }); // whether this counts against the source, from callVerdict
  const outcome = read.outcome === 'ok' && verdict.failed ? 'failed' : read.outcome;

  if (outcome !== 'wrong_run') {
    await saveHealth(
      read.source,
      verdict.failed ? afterFailure(read.health, now, verdict.isRateLimited) : afterSuccess(),
      now,
      config.db,
    );
  }
  if (outcome === 'blocked') {
    await saveBlock(read.source, afterBlock(read.block, now), now, config.db);
  } else if (outcome === 'ok' && read.block.blockedAt !== null) {
    await saveBlock(read.source, NOT_BLOCKED, now, config.db);
  }
  return outcome;
}
