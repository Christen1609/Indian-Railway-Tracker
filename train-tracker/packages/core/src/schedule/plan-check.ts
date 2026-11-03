// Features: the order scrape sources are asked in during one check

import type { SourceId } from '../types.js';

const CONFIRMTKT: SourceId = 'confirmtkt_scrape';
const RAILYATRI: SourceId = 'railyatri_scrape';
const GOIBIBO: SourceId = 'goibibo_scrape';
const TRAVELKHANA: SourceId = 'travelkhana_scrape';
const RAILMITRA: SourceId = 'railmitra_scrape';

export type TriedOutcome = 'ok' | 'skipped' | 'failed' | 'unavailable' | 'wrong_run' | 'blocked';

export type Tried = { source: SourceId; outcome: TriedOutcome };

export type CheckPlan = { next: SourceId | null };

/** The latest outcome of each source tried so far in this check */
function latestOutcomes(tried: readonly Tried[]): ReadonlyMap<SourceId, TriedOutcome> {
  return new Map(tried.map((step) => [step.source, step.outcome]));
}

/** The next scrape source to ask in this check, or null when the check is finished */
export function planCheck(tried: readonly Tried[]): CheckPlan {
  const outcomes = latestOutcomes(tried); // each source's latest outcome, from latestOutcomes
  const isTried = (source: SourceId): boolean => outcomes.has(source);
  const isGiven = (source: SourceId): boolean => outcomes.get(source) === 'ok';

  if (!isTried(CONFIRMTKT)) {
    return { next: CONFIRMTKT };
  }
  if (!isTried(RAILYATRI)) {
    return { next: RAILYATRI };
  }
  if (!isGiven(RAILYATRI) && !isTried(GOIBIBO)) {
    return { next: GOIBIBO };
  }
  if (!isGiven(CONFIRMTKT) && !isTried(TRAVELKHANA)) {
    return { next: TRAVELKHANA };
  }

  const isNoneGiven = [CONFIRMTKT, RAILYATRI, GOIBIBO, TRAVELKHANA].every(
    (source) => !isGiven(source),
  );
  return { next: isNoneGiven && !isTried(RAILMITRA) ? RAILMITRA : null };
}
