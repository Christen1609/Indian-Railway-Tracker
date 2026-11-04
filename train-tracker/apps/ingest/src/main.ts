// Features: the watch list, the wait between passes, the exit with a sweep

import { quotaCheck } from '@train-tracker/core/schedule/quota';
import { plusMinutes } from '@train-tracker/core/time';
import type { SourceId } from '@train-tracker/core/types';
import { readConfig } from './config.js';
import { callsThisMonth } from './db/journey-data.js';
import { sweepJourneys } from './jobs/sweep.js';
import { log } from './log.js';
import { settleRequests, watchList } from './scheduler/timetable.js';
import { waitBeforeNext, watchRound } from './scheduler/watch.js';
import type { Run } from './scheduler/watch.js';

const RAILRADAR: SourceId = 'railradar';
const TRAIN_NUMBER = /^\d{4,5}$/;
const IDLE_MIN = 60;

/** Waits a number of milliseconds */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Watches the trains named on the command line and the trains the website asked for until the time limit, then sweeps and exits */
async function main(): Promise<void> {
  const config = readConfig(process.env); // the validated config, from readConfig
  const named = process.argv.slice(2).filter((one) => TRAIN_NUMBER.test(one));

  const run: Run = { config, watchingSince: new Date().toISOString(), holds: new Map() };
  // when this run must end, from plusMinutes
  const endsAt =
    config.workerMaxMin === null ? null : plusMinutes(run.watchingSince, config.workerMaxMin);
  const spentThisMonth = await callsThisMonth(RAILRADAR, run.watchingSince, config.db); // calls so far, from callsThisMonth
  // what is left to spend, from quotaCheck
  const budget = quotaCheck({ ...config.quota, spentThisMonth });

  log('info', 'worker_started', {
    named: named.join(','),
    endsAt,
    spentThisMonth,
    left: budget.left,
  });

  for (;;) {
    const now = new Date().toISOString();
    const retryAt = await settleRequests(config, now); // when a waiting request may be tried again, from settleRequests
    const watching = await watchList(named, config, now); // the trains to follow this round, from watchList
    const due = await watchRound(watching, run); // when the next train is due, from watchRound
    const soonest = [due, retryAt].filter((one): one is string => one !== null).sort()[0];
    const idleUntil = watching.length === 0 ? plusMinutes(now, IDLE_MIN) : now;
    const sleeping = waitBeforeNext(soonest ?? idleUntil, new Date().toISOString(), endsAt); // how long to wait, from waitBeforeNext

    if (sleeping === null) {
      log('info', 'worker_time_up', { watching: watching.join(','), endsAt });
      await sweepJourneys(config, new Date().toISOString()); // clears what is old, from sweepJourneys
      return;
    }

    log('debug', 'waiting', { ms: sleeping, until: soonest ?? null });
    await wait(sleeping);
  }
}

await main();
