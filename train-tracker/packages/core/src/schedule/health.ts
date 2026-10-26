// Features: what counts as a failure, the backoff, the circuit breaker

import { minutesBetween, plusMinutes } from '../time.js';
import type { IsoUtc } from '../types.js';

const BACKOFF_FIRST_MIN = 1;
const BACKOFF_CAP_MIN = 30;
const BACKOFF_FACTOR = 2;
const FAILURES_TO_OPEN = 5;
const CIRCUIT_OPEN_MIN = 60;
const TOO_MANY_REQUESTS = 429;
const OK = 200;
const NO_FAILURES = 0;

export type SourceHealth = {
  failures: number;
  lastFailureAt: IsoUtc | null;
  openedAt: IsoUtc | null;
};

export type HealthReason = 'ok' | 'backing_off' | 'circuit_open';

export type HealthVerdict = {
  usable: boolean;
  reason: HealthReason;
  readyAt: IsoUtc | null;
};

export type CallResult = { status: number; hasError: boolean; parseErrors: number };

export const HEALTHY: SourceHealth = { failures: NO_FAILURES, lastFailureAt: null, openedAt: null };

/** How long to wait before asking a source again, after this many failures in a row */
export function backoffMin(failures: number): number {
  return Math.min(BACKOFF_CAP_MIN, BACKOFF_FIRST_MIN * BACKOFF_FACTOR ** (failures - 1));
}

/** Whether a call counts against a source's health, and whether it was rate limited */
export function callVerdict(result: CallResult): { failed: boolean; isRateLimited: boolean } {
  const isRateLimited = result.status === TOO_MANY_REQUESTS;
  const failed =
    result.hasError || result.status !== OK || result.parseErrors > NO_FAILURES || isRateLimited;
  return { failed, isRateLimited };
}

/** Whether a source may be called now, and when it is ready if not */
export function sourceUsable(health: SourceHealth, now: IsoUtc): HealthVerdict {
  const usable: HealthVerdict = { usable: true, reason: 'ok', readyAt: null };

  if (health.openedAt !== null) {
    const readyAt = plusMinutes(health.openedAt, CIRCUIT_OPEN_MIN); // when it reopens, from plusMinutes
    return minutesBetween(now, readyAt) > NO_FAILURES
      ? { usable: false, reason: 'circuit_open', readyAt }
      : usable;
  }

  if (health.failures > NO_FAILURES && health.lastFailureAt !== null) {
    // when the backoff is spent, from plusMinutes
    const readyAt = plusMinutes(health.lastFailureAt, backoffMin(health.failures));
    return minutesBetween(now, readyAt) > NO_FAILURES
      ? { usable: false, reason: 'backing_off', readyAt }
      : usable;
  }

  return usable;
}

/** The health of a source after a call failed */
export function afterFailure(
  health: SourceHealth,
  failedAt: IsoUtc,
  isRateLimited: boolean,
): SourceHealth {
  const failures = health.failures + 1;
  const opens = isRateLimited || failures >= FAILURES_TO_OPEN;
  return { failures, lastFailureAt: failedAt, openedAt: opens ? failedAt : null };
}

/** The health of a source after a call worked */
export function afterSuccess(): SourceHealth {
  return HEALTHY;
}
