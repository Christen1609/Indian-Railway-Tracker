// Features: when a train is next worth a look, the budget gate, one pass over the list, holding back a failing train

import { backoffMin, sourceUsable } from '@train-tracker/core/schedule/health';
import { nextJourneyCheck } from '@train-tracker/core/schedule/next-check';
import { quotaCheck } from '@train-tracker/core/schedule/quota';
import { plusMinutes } from '@train-tracker/core/time';
import type { IsoUtc, SourceId } from '@train-tracker/core/types';
import type { Config } from '../config.js';
import { callsThisMonth, latestJourneyFor, stateFor, timetableFor } from '../db/journey-data.js';
import { healthFor } from '../db/source-health.js';
import { log } from '../log.js';
import { checkJourney } from './check-journey.js';

const RAILRADAR: SourceId = 'railradar';

type Hold = { failures: number; until: IsoUtc };

export type Run = { config: Config; watchingSince: IsoUtc; holds: Map<string, Hold> };

/** When this train is next worth looking at */
async function nextLook(trainNumber: string, run: Run, now: IsoUtc): Promise<IsoUtc> {
  const journey = await latestJourneyFor(trainNumber, run.config.db); // the newest journey, from latestJourneyFor
  if (journey === null) {
    return now;
  }
  const memory = await stateFor(journey.id, run.config.db); // what we last wrote, from stateFor
  if (memory === null) {
    return now;
  }
  if (memory.nextCheckAt !== null) {
    return memory.nextCheckAt;
  }
  const stops = await timetableFor(trainNumber, run.config.db); // the route, from timetableFor
  // the departure check of the next journey, from nextJourneyCheck
  return nextJourneyCheck({
    journeyDate: journey.journeyDate,
    stops,
    lastCheckedAt: memory.updatedAt,
    departureDelayMin: run.config.intervals.departureDelayMin,
  });
}

/** Checks one watched train when it is due and allowed, and says when to look again, or null once the budget is spent */
async function pass(trainNumber: string, run: Run): Promise<IsoUtc | null> {
  const now = new Date().toISOString();
  const hold = run.holds.get(trainNumber);

  if (hold !== undefined && Date.parse(hold.until) > Date.parse(now)) {
    return hold.until;
  }

  const due = await nextLook(trainNumber, run, now); // when it is next worth looking, from nextLook

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
  const budget = quotaCheck({ ...run.config.quota, spentThisMonth });

  if (!budget.spend) {
    log('warn', budget.reason, { source: RAILRADAR, trainNumber, spentThisMonth });
    return null;
  }

  // the result of one check, from checkJourney
  const outcome = await checkJourney({
    trainNumber,
    config: run.config,
    health,
    watchingSince: run.watchingSince,
    now,
  });
  run.holds.delete(trainNumber);
  return outcome?.nextCheckAt ?? now;
}

/** Holds a train back after a failed pass, longer each time, and says until when */
function holdBack(trainNumber: string, run: Run): IsoUtc {
  const failures = (run.holds.get(trainNumber)?.failures ?? 0) + 1;
  // when to try again, from plusMinutes and backoffMin
  const until = plusMinutes(new Date().toISOString(), backoffMin(failures));
  run.holds.set(trainNumber, { failures, until });
  return until;
}

/** One pass over the watch list: when the next train is due, or null when none can be checked */
export async function watchRound(watching: readonly string[], run: Run): Promise<IsoUtc | null> {
  const due: (IsoUtc | null)[] = [];

  for (const trainNumber of watching) {
    try {
      due.push(await pass(trainNumber, run)); // when it is next due, from pass
    } catch (cause) {
      const retryAt = holdBack(trainNumber, run); // when to try again, from holdBack
      due.push(retryAt);
      log('error', 'pass_failed', {
        trainNumber,
        retryAt,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  return due.filter((one): one is IsoUtc => one !== null).sort()[0] ?? null;
}
