// Features: the watch list, the wait between passes

import { quotaCheck } from '@train-tracker/core/schedule/quota';
import type { IsoUtc, SourceId } from '@train-tracker/core/types';
import { readConfig } from './config.js';
import { callsThisMonth } from './db/journey-data.js';
import { sweepJourneys } from './jobs/sweep.js';
import { log } from './log.js';
import { watchRound } from './scheduler/watch.js';
import type { Run } from './scheduler/watch.js';

const RAILRADAR: SourceId = 'railradar';
const TRAIN_NUMBER = /^\d{4,5}$/;
const WAIT_FLOOR_MS = 20_000;
const WAIT_CEILING_MS = 300_000;

/** Waits a number of milliseconds */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** How long to wait before looking at the watch list again */
function waitMs(soonest: IsoUtc, now: IsoUtc): number {
  const gap = Date.parse(soonest) - Date.parse(now);
  return Math.min(WAIT_CEILING_MS, Math.max(WAIT_FLOOR_MS, gap));
}

/** Watches the trains named on the command line until the monthly budget stops every one of them */
async function main(): Promise<void> {
  const config = readConfig(process.env); // the validated config, from readConfig
  const watching = process.argv.slice(2).filter((one) => TRAIN_NUMBER.test(one));

  if (watching.length === 0) {
    throw new Error(
      'Nothing to watch. Give one or more train numbers, as in: pnpm --filter @train-tracker/ingest start 12951',
    );
  }

  const run: Run = { config, watchingSince: new Date().toISOString(), holds: new Map() };
  const spentThisMonth = await callsThisMonth(RAILRADAR, run.watchingSince, config.db); // calls so far, from callsThisMonth
  // what is left to spend, from quotaCheck
  const budget = quotaCheck({ ...config.quota, spentThisMonth });

  log('info', 'worker_started', {
    watching: watching.join(','),
    supabase: config.db.url,
    spentThisMonth,
    left: budget.left,
  });

  for (;;) {
    const now = new Date().toISOString();
    const soonest = await watchRound(watching, run); // when the next train is due, from watchRound

    if (soonest === null) {
      log('info', 'nothing_left_to_watch', { watching: watching.join(',') });
      await sweepJourneys(config, new Date().toISOString()); // clears what is old, from sweepJourneys
      return;
    }

    const sleeping = waitMs(soonest, now); // how long to wait, from waitMs
    log('debug', 'waiting', { ms: sleeping, until: soonest });
    await wait(sleeping);
  }
}

await main();
