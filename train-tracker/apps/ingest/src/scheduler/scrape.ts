// Features: what stands in front of a scrape source's page: the switches, the address, the circuit, the gate and robots.txt

import { sourceUsable } from '@train-tracker/core/schedule/health';
import type { HealthVerdict, SourceHealth } from '@train-tracker/core/schedule/health';
import { robotsAllow, robotsDue } from '@train-tracker/core/schedule/robots';
import { scrapeGate } from '@train-tracker/core/schedule/scrape-gate';
import type { BlockState, GateReason } from '@train-tracker/core/schedule/scrape-gate';
import { istDateOf, plusMinutes } from '@train-tracker/core/time';
import type { IsoDate, IsoUtc } from '@train-tracker/core/types';
import { fetchPage } from '../adapters/scrape.js';
import { scrapeUrl } from '../adapters/scrape-sites.js';
import type { ScrapeSource, SkipReason } from '../adapters/scrape-sites.js';
import type { Config } from '../config.js';
import { insertRawFetch, rawFetchRow, robotsFor, scrapeStateFor } from '../db/raw-fetches.js';
import { blockFor, healthFor } from '../db/source-health.js';
import { log } from '../log.js';

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
