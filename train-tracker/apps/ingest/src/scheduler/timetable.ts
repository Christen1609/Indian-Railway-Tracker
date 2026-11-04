// Features: answering the website's requests with a timetable, the watch list the worker follows

import { parseGoibiboTimetable, nextDataPart } from '@train-tracker/core/sources/goibibo';
import { MINUTES_PER_DAY, istDateOf, plusMinutes } from '@train-tracker/core/time';
import type { IsoUtc } from '@train-tracker/core/types';
import { fetchPage } from '../adapters/scrape.js';
import type { Config } from '../config.js';
import { timetableFor } from '../db/journey-data.js';
import { insertRawFetch, rawFetchRow } from '../db/raw-fetches.js';
import {
  answerRequest,
  pendingRequests,
  requestedSince,
  saveTimetable,
} from '../db/watch-requests.js';
import { log } from '../log.js';
import { classifyRead, prepareScrape, settleScrape } from './scrape.js';
import type { ScrapeRead, ScrapeSkip } from './scrape.js';

const SOURCE = 'goibibo_scrape';
const MAX_REQUESTED_TRAINS = 25;
const REQUEST_LIFE_DAYS = 3;
const NOT_FOUND = 404;
const REASON_MAX_LENGTH = 200;
const TIMETABLE_PATH = [
  'props',
  'pageProps',
  'initialSeoData',
  'data',
  'scheduledIntermediateApiResponse',
];
const NEVER_WITHOUT_CHANGE: readonly ScrapeSkip[] = [
  'disabled',
  'source_off',
  'robots_disallowed',
  'blocked',
];

/** Fetches, parses and saves one train's timetable, and says when to try again if the site may not be asked yet */
async function fetchTimetable(
  trainNumber: string,
  config: Config,
  now: IsoUtc,
): Promise<{ retryAt: IsoUtc | null }> {
  const day = istDateOf(now);
  // whether the page may be fetched, from prepareScrape
  const ready = await prepareScrape({
    source: SOURCE,
    trainNumber,
    journeyDate: day,
    journeyId: null,
    config,
    now,
  });
  if (ready.kind === 'skipped') {
    if (NEVER_WITHOUT_CHANGE.includes(ready.reason)) {
      await answerRequest(
        trainNumber,
        'failed',
        `site not available: ${ready.reason}`,
        now,
        config.db,
      );
      return { retryAt: null };
    }
    return { retryAt: ready.readyAt };
  }

  const raw = await fetchPage(SOURCE, ready.url); // the page, from fetchPage
  const parsed = parseGoibiboTimetable(raw); // halts and run days, from parseGoibiboTimetable
  const transport = { events: [], errors: [], journeyDate: day };
  const { outcome, call } = classifyRead(raw, transport, day); // how the fetch itself went, from classifyRead
  const kept = parsed.errors.length > 0 ? null : nextDataPart(raw.body, TIMETABLE_PATH); // the timetable part, from nextDataPart
  const rawFetchId = await insertRawFetch(
    rawFetchRow(kept === null ? raw : { ...raw, body: kept }, null),
    config.db,
  );
  if (raw.status !== NOT_FOUND) {
    const read: ScrapeRead = {
      kind: 'read',
      source: SOURCE,
      outcome,
      raw,
      rawFetchId,
      parsed: transport,
      call,
      health: ready.health,
      block: ready.block,
    };
    await settleScrape(read, [], config, now); // health, block and any issue, from settleScrape
  }

  if (parsed.errors.length > 0) {
    const reason = parsed.errors.join(' ').slice(0, REASON_MAX_LENGTH);
    log('warn', 'timetable_failed', { trainNumber, reason });
    await answerRequest(trainNumber, 'failed', reason, now, config.db);
    return { retryAt: null };
  }
  await saveTimetable(trainNumber, parsed.halts, parsed.runsOn, config.db);
  await answerRequest(trainNumber, 'ready', null, now, config.db);
  log('info', 'timetable_saved', { trainNumber, halts: parsed.halts.length });
  return { retryAt: null };
}

/** Answers every pending request, fetching a timetable only for a train that has none, and says when to look again */
export async function settleRequests(config: Config, now: IsoUtc): Promise<IsoUtc | null> {
  const retries: IsoUtc[] = [];
  for (const trainNumber of await pendingRequests(config.db)) {
    try {
      const stops = await timetableFor(trainNumber, config.db); // the timetable we hold, from timetableFor
      if (stops.length > 0) {
        await answerRequest(trainNumber, 'ready', null, now, config.db);
        continue;
      }
      const { retryAt } = await fetchTimetable(trainNumber, config, now); // the outcome, from fetchTimetable
      if (retryAt !== null) {
        retries.push(retryAt);
      }
    } catch (cause) {
      log('error', 'request_failed', {
        trainNumber,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
  return retries.sort()[0] ?? null;
}

/** The trains to follow this round: the ones named at the start, then the newest requests that are ready */
export async function watchList(
  named: readonly string[],
  config: Config,
  now: IsoUtc,
): Promise<string[]> {
  const since = plusMinutes(now, -REQUEST_LIFE_DAYS * MINUTES_PER_DAY); // the oldest request still followed, from plusMinutes
  const requested = await requestedSince(since, MAX_REQUESTED_TRAINS, config.db); // requested trains, from requestedSince
  return [...new Set([...named, ...requested])];
}
