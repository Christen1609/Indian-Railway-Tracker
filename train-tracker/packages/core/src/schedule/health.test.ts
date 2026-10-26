import { describe, expect, it } from 'vitest';
import { plusMinutes } from '../time.js';
import {
  HEALTHY,
  afterFailure,
  afterSuccess,
  backoffMin,
  callVerdict,
  sourceUsable,
} from './health.js';
import type { SourceHealth } from './health.js';

const NOW = '2026-10-26T06:00:00.000Z';
const FAILURES_TO_OPEN = 5;
const CIRCUIT_OPEN_MIN = 60;

/** A source that has failed a number of times in a row, the last one just now */
function failing(failures: number, failedAt = NOW): SourceHealth {
  let health = HEALTHY;
  for (let count = 0; count < failures; count += 1) {
    health = afterFailure(health, failedAt, false); // health after a failure, from afterFailure
  }
  return health;
}

describe('backoffMin', () => {
  it('doubles the wait with each failure in a row', () => {
    expect([1, 2, 3, 4].map(backoffMin)).toEqual([1, 2, 4, 8]);
  });

  it('never waits longer than 30 min', () => {
    expect(backoffMin(6)).toBe(30);
    expect(backoffMin(20)).toBe(30);
  });
});

describe('callVerdict, what counts as a failure', () => {
  it('passes a clean 200 with nothing unparsed', () => {
    expect(callVerdict({ status: 200, hasError: false, parseErrors: 0 })).toEqual({
      failed: false,
      isRateLimited: false,
    });
  });

  it('counts a request that never completed', () => {
    expect(callVerdict({ status: 0, hasError: true, parseErrors: 0 }).failed).toBe(true);
  });

  it('counts a bad status', () => {
    expect(callVerdict({ status: 500, hasError: false, parseErrors: 0 }).failed).toBe(true);
  });

  it('counts junk: a source we cannot parse is a source that is down', () => {
    expect(callVerdict({ status: 200, hasError: false, parseErrors: 3 }).failed).toBe(true);
  });

  it('marks 429 as a rate limit, not just a failure', () => {
    expect(callVerdict({ status: 429, hasError: false, parseErrors: 0 })).toEqual({
      failed: true,
      isRateLimited: true,
    });
  });
});

describe('sourceUsable, backing off', () => {
  it('uses a healthy source at once', () => {
    expect(sourceUsable(HEALTHY, NOW)).toEqual({ usable: true, reason: 'ok', readyAt: null });
  });

  it('holds a source back for the backoff after one failure', () => {
    const verdict = sourceUsable(failing(1), NOW);
    expect(verdict).toEqual({
      usable: false,
      reason: 'backing_off',
      readyAt: plusMinutes(NOW, 1),
    });
  });

  it('waits longer after each failure', () => {
    expect(sourceUsable(failing(3), NOW).readyAt).toBe(plusMinutes(NOW, 4));
  });

  it('uses the source again once the backoff is spent', () => {
    expect(sourceUsable(failing(3), plusMinutes(NOW, 4)).usable).toBe(true);
  });
});

describe('sourceUsable, the circuit breaker', () => {
  it('opens the circuit after five failures in a row', () => {
    const verdict = sourceUsable(failing(FAILURES_TO_OPEN), NOW);
    expect(verdict).toEqual({
      usable: false,
      reason: 'circuit_open',
      readyAt: plusMinutes(NOW, CIRCUIT_OPEN_MIN),
    });
  });

  it('opens the circuit straight away on a rate limit, at the first failure', () => {
    const limited = afterFailure(HEALTHY, NOW, true); // health after a failure, from afterFailure
    expect(limited.failures).toBe(1);
    expect(sourceUsable(limited, NOW).reason).toBe('circuit_open');
  });

  it('keeps the circuit shut for an hour, not for the backoff', () => {
    const health = failing(FAILURES_TO_OPEN);
    expect(sourceUsable(health, plusMinutes(NOW, 59)).usable).toBe(false);
    expect(sourceUsable(health, plusMinutes(NOW, 60)).usable).toBe(true);
  });

  it('opens for another hour when the source fails again on reopening', () => {
    const reopened = plusMinutes(NOW, 60);
    const again = afterFailure(failing(FAILURES_TO_OPEN), reopened, false); // health after a failure, from afterFailure
    expect(sourceUsable(again, reopened).readyAt).toBe(plusMinutes(reopened, CIRCUIT_OPEN_MIN));
  });
});

describe('afterSuccess', () => {
  it('forgets every failure, so a recovered source is not still punished', () => {
    expect(afterSuccess()).toEqual(HEALTHY);
    expect(sourceUsable(afterSuccess(), NOW).usable).toBe(true);
  });
});
