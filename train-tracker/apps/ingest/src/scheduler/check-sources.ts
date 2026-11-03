// Features: asking the scrape sources for one check in order

import { normalizeEvents } from '@train-tracker/core/fusion/normalize';
import type { NormalizeContext } from '@train-tracker/core/fusion/normalize';
import { planCheck } from '@train-tracker/core/schedule/plan-check';
import type { Tried } from '@train-tracker/core/schedule/plan-check';
import type { RailRadarVerdict } from '@train-tracker/core/schedule/quota';
import { plusMinutes } from '@train-tracker/core/time';
import type { IsoUtc, SourceEvent } from '@train-tracker/core/types';
import type { Config } from '../config.js';
import { saveSourceEvents } from '../db/journey-data.js';
import { triedSince } from '../db/raw-fetches.js';
import { readScrape, settleScrape } from './scrape.js';
import type { ScrapeSkip } from './scrape.js';

const GATE_HOLDS: readonly ScrapeSkip[] = ['too_soon', 'url_too_soon', 'robots_fetched'];
const NEXT_REQUEST_MIN = 1;
const MOST_SOURCES = 5;

export type SourcesInput = {
  trainNumber: string;
  journey: { id: string; isScored: boolean };
  config: Config;
  now: IsoUtc;
  dueAt: IsoUtc;
  context: NormalizeContext;
};

export type SourcesResult = {
  status: 'held' | 'done';
  readyAt: IsoUtc | null;
  events: SourceEvent[];
  updatedAts: IsoUtc[];
  railRadar: RailRadarVerdict | null;
};

/** Asks the scrape sources in order until the check has what it needs or the gate holds it, then weighs RailRadar */
export async function askSources(input: SourcesInput): Promise<SourcesResult> {
  const { trainNumber, journey, config, now, context } = input;
  const tried: Tried[] = await triedSince(journey.id, input.dueAt, config.db); // what this check already read, from triedSince
  const events: SourceEvent[] = [];
  const updatedAts: IsoUtc[] = [];

  for (let step = 0; step < MOST_SOURCES; step += 1) {
    const { next: source } = planCheck(tried); // the next source to ask, from planCheck
    if (source === null || source === 'railradar') {
      break;
    }

    // the page, or why not, from readScrape
    const result = await readScrape({
      source,
      trainNumber,
      journeyDate: context.journeyDate,
      journeyId: journey.id,
      config,
      now,
    });
    if (result.kind === 'skipped') {
      if (GATE_HOLDS.includes(result.reason)) {
        const readyAt = result.readyAt ?? plusMinutes(now, NEXT_REQUEST_MIN);
        return { status: 'held', readyAt, events, updatedAts, railRadar: null };
      }
      tried.push({ source, outcome: 'skipped' });
      continue;
    }

    // events with the nonsense rules applied, from normalizeEvents
    const normalized = normalizeEvents(result.parsed.events, context);
    const unknownHalts = normalized.filter((event) => event.rejected === 'unknown_halt').length;
    // how the read counts for the source, from settleScrape
    const outcome = await settleScrape(result, unknownHalts, config, now);
    tried.push({ source, outcome });

    if (outcome === 'wrong_run') {
      continue;
    }
    await saveSourceEvents(normalized, journey.id, config.db);
    events.push(...normalized);
    if (result.parsed.updatedAt !== undefined && (outcome === 'ok' || outcome === 'failed')) {
      updatedAts.push(result.parsed.updatedAt);
    }
  }

  return { status: 'done', readyAt: null, events, updatedAts, railRadar: null };
}
