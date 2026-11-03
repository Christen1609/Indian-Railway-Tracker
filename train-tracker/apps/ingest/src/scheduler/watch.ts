// Features: when a train is next worth a look, one pass over the list, holding back a held or failing train, the wait between passes

import { backoffMin } from '@train-tracker/core/schedule/health';
import { nextJourneyCheck } from '@train-tracker/core/schedule/next-check';
import { plusMinutes } from '@train-tracker/core/time';
import type { IsoUtc } from '@train-tracker/core/types';
import type { Config } from '../config.js';
import { latestJourneyFor, stateFor, timetableFor } from '../db/journey-data.js';
import { log } from '../log.js';
import { checkJourney } from './check-journey.js';

const WAIT_FLOOR_MS = 20_000;
const WAIT_CEILING_MS = 300_000;

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

/** Checks one watched train when it is due, and says when to look again, which is the gate's ready time when it holds the check */
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

  // the result of one check, from checkJourney
  const outcome = await checkJourney({
    trainNumber,
    config: run.config,
    watchingSince: run.watchingSince,
    dueAt: due,
    now,
  });
  if (outcome.kind === 'held') {
    run.holds.set(trainNumber, { failures: 0, until: outcome.readyAt });
    return outcome.readyAt;
  }
  run.holds.delete(trainNumber);
  return outcome.nextCheckAt ?? now;
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

/** How long to wait before the next pass, or null once the run's time is up */
export function waitBeforeNext(soonest: IsoUtc, now: IsoUtc, endsAt: IsoUtc | null): number | null {
  const left = endsAt === null ? Infinity : Date.parse(endsAt) - Date.parse(now);
  if (left <= 0) {
    return null;
  }
  const gap = Date.parse(soonest) - Date.parse(now);
  return Math.min(left, WAIT_CEILING_MS, Math.max(WAIT_FLOOR_MS, gap));
}
