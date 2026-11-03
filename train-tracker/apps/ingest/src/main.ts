// Features: the watch list, the wait between passes, the exit with a sweep

import { quotaCheck } from '@train-tracker/core/schedule/quota';
import { plusMinutes } from '@train-tracker/core/time';
import type { SourceId } from '@train-tracker/core/types';
import { readConfig } from './config.js';
import { callsThisMonth } from './db/journey-data.js';
import { sweepJourneys } from './jobs/sweep.js';
import { log } from './log.js';
import { waitBeforeNext, watchRound } from './scheduler/watch.js';
import type { Run } from './scheduler/watch.js';

const RAILRADAR: SourceId = 'railradar';
const TRAIN_NUMBER = /^\d{4,5}$/;

/** Waits a number of milliseconds */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Watches the trains named on the command line until the time limit, then sweeps and exits */
async function main(): Promise<void> {
  const config = readConfig(process.env); // the validated config, from readConfig
  const watching = process.argv.slice(2).filter((one) => TRAIN_NUMBER.test(one));

  if (watching.length === 0) {
    throw new Error(
      'Nothing to watch. Give one or more train numbers, as in: pnpm --filter @train-tracker/ingest start 12951',
    );
  }

  const run: Run = { config, watchingSince: new Date().toISOString(), holds: new Map() };
  // when this run must end, from plusMinutes
  const endsAt =
    config.workerMaxMin === null ? null : plusMinutes(run.watchingSince, config.workerMaxMin);
  const spentThisMonth = await callsThisMonth(RAILRADAR, run.watchingSince, config.db); // calls so far, from callsThisMonth
  // what is left to spend, from quotaCheck
  const budget = quotaCheck({ ...config.quota, spentThisMonth });

  log('info', 'worker_started', {
    watching: watching.join(','),
    endsAt,
    spentThisMonth,
    left: budget.left,
  });

  for (;;) {
    const now = new Date().toISOString();
    const soonest = await watchRound(watching, run); // when the next train is due, from watchRound
    const sleeping = waitBeforeNext(soonest ?? now, new Date().toISOString(), endsAt); // how long to wait, from waitBeforeNext

    if (sleeping === null) {
      log('info', 'worker_time_up', { watching: watching.join(','), endsAt });
      await sweepJourneys(config, new Date().toISOString()); // clears what is old, from sweepJourneys
      return;
    }

    log('debug', 'waiting', { ms: sleeping, until: soonest });
    await wait(sleeping);
  }
}

await main();
