// Features: the watch list, the budget gate, one pass over the list, the wait between passes

import { sourceUsable } from '@train-tracker/core/schedule/health';
import { quotaCheck } from '@train-tracker/core/schedule/quota';
import type { IsoUtc, SourceId } from '@train-tracker/core/types';
import { readConfig } from './config.js';
import type { Config } from './config.js';
import { callsThisMonth, latestJourneyFor, stateFor } from './db/journey-data.js';
import { healthFor } from './db/source-health.js';
import { log } from './log.js';
import { checkJourney } from './scheduler/check-journey.js';

const RAILRADAR: SourceId = 'railradar';
const TRAIN_NUMBER = /^\d{4,5}$/;
const DEMO_FLAG = '--demo';
const WAIT_FLOOR_MS = 20_000;
const WAIT_CEILING_MS = 300_000;
const PACED_RETRY_MS = 3_600_000;

type Run = { config: Config; watchingSince: IsoUtc; isDemo: boolean };

/** Waits a number of milliseconds */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** How long to wait before looking at the watch list again */
function waitMs(soonest: IsoUtc | null, now: IsoUtc): number {
  if (soonest === null) {
    return WAIT_CEILING_MS;
  }
  const gap = Date.parse(soonest) - Date.parse(now);
  return Math.min(WAIT_CEILING_MS, Math.max(WAIT_FLOOR_MS, gap));
}

/** When this journey is next worth looking at, or null when it needs nothing more */
async function nextLook(trainNumber: string, run: Run, now: IsoUtc): Promise<IsoUtc | null> {
  const journey = await latestJourneyFor(trainNumber, run.config.db); // the newest journey, from latestJourneyFor
  if (journey === null) {
    return now;
  }
  const memory = await stateFor(journey.id, run.config.db); // what we last wrote, from stateFor
  if (memory === null) {
    return now;
  }
  if (memory.nextCheckAt === null) {
    return null;
  }
  return memory.nextCheckAt;
}

/** Checks one watched train when it is due and the budget allows, and says when it is next due */
async function pass(trainNumber: string, run: Run): Promise<IsoUtc | null> {
  const now = new Date().toISOString();
  const due = await nextLook(trainNumber, run, now); // when it is next worth looking, from nextLook

  if (due === null) {
    return null;
  }
  if (Date.parse(due) > Date.parse(now)) {
    return due;
  }

  const health = await healthFor(RAILRADAR, run.config.db); // how the source is behaving, from healthFor
  const usable = sourceUsable(health, now); // whether it may be called, from sourceUsable

  if (!usable.usable) {
    log('warn', usable.reason, {
      source: RAILRADAR,
      trainNumber,
      failures: health.failures,
      readyAt: usable.readyAt,
    });
    return usable.readyAt;
  }

  const spentThisMonth = await callsThisMonth(RAILRADAR, now, run.config.db); // calls so far, from callsThisMonth
  // whether the budget allows this call, from quotaCheck
  const budget = quotaCheck({
    ...run.config.quota,
    spentThisMonth,
    isDemo: run.isDemo,
    now,
  });

  if (!budget.spend) {
    log('warn', budget.reason, {
      source: RAILRADAR,
      trainNumber,
      spentThisMonth,
      allowance: budget.allowance,
      left: budget.left,
    });
    return budget.reason === 'quota_spent'
      ? null
      : new Date(Date.parse(now) + PACED_RETRY_MS).toISOString();
  }

  // the result of one check, from checkJourney
  const outcome = await checkJourney({
    trainNumber,
    config: run.config,
    health,
    watchingSince: run.watchingSince,
    now,
  });
  return outcome?.nextCheckAt ?? null;
}

/** Watches the trains named on the command line until none of them is due again */
async function main(): Promise<void> {
  const config = readConfig(process.env); // the validated config, from readConfig
  const given = process.argv.slice(2);
  const watching = given.filter((one) => TRAIN_NUMBER.test(one));
  const isDemo = given.includes(DEMO_FLAG);

  if (watching.length === 0) {
    throw new Error(
      'Nothing to watch. Give one or more train numbers, as in: pnpm --filter @train-tracker/ingest start 12951',
    );
  }

  const run: Run = { config, watchingSince: new Date().toISOString(), isDemo };
  const spentThisMonth = await callsThisMonth(RAILRADAR, run.watchingSince, config.db); // calls so far, from callsThisMonth
  // what is left to spend, from quotaCheck
  const budget = quotaCheck({ ...config.quota, spentThisMonth, isDemo, now: run.watchingSince });

  log('info', 'worker_started', {
    watching: watching.join(','),
    supabase: config.db.url,
    isDemo,
    spentThisMonth,
    allowance: budget.allowance,
    left: budget.left,
  });

  for (;;) {
    const now = new Date().toISOString();
    const due: (IsoUtc | null)[] = [];

    for (const trainNumber of watching) {
      try {
        due.push(await pass(trainNumber, run)); // when it is next due, from pass
      } catch (cause) {
        due.push(null);
        log('error', 'pass_failed', {
          trainNumber,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }

    if (due.every((one) => one === null)) {
      log('info', 'nothing_left_to_watch', { watching: watching.join(',') });
      return;
    }

    const soonest = due.filter((one): one is IsoUtc => one !== null).sort()[0] ?? null;
    const sleeping = waitMs(soonest, now); // how long to wait, from waitMs
    log('debug', 'waiting', { ms: sleeping, until: soonest });
    await wait(sleeping);
  }
}

await main();
