import { describe, expect, it } from 'vitest';
import { planCheck } from './plan-check.js';
import type { Tried, TriedOutcome } from './plan-check.js';

const CONFIRMTKT = 'confirmtkt_scrape';
const RAILYATRI = 'railyatri_scrape';
const GOIBIBO = 'goibibo_scrape';
const TRAVELKHANA = 'travelkhana_scrape';
const RAILMITRA = 'railmitra_scrape';

/** The sources tried so far in a check, each with how it went, in order */
function after(...steps: [Tried['source'], TriedOutcome][]): Tried[] {
  return steps.map(([source, outcome]) => ({ source, outcome }));
}

const NOT_OK: TriedOutcome[] = ['skipped', 'failed', 'unavailable', 'wrong_run', 'blocked'];

describe('planCheck, the first two sources', () => {
  it('starts with ConfirmTkt, always', () => {
    expect(planCheck([]).next).toBe(CONFIRMTKT);
  });

  it('asks RailYatri next, whatever ConfirmTkt said', () => {
    for (const outcome of ['ok', ...NOT_OK] as TriedOutcome[]) {
      expect(planCheck(after([CONFIRMTKT, outcome])).next).toBe(RAILYATRI);
    }
  });

  it('is finished after ConfirmTkt and RailYatri when both read fine', () => {
    expect(planCheck(after([CONFIRMTKT, 'ok'], [RAILYATRI, 'ok'])).next).toBeNull();
  });
});

describe('planCheck, Goibibo as the second opinion', () => {
  it.each(NOT_OK)('comes in when RailYatri gave %s', (outcome) => {
    expect(planCheck(after([CONFIRMTKT, 'ok'], [RAILYATRI, outcome])).next).toBe(GOIBIBO);
  });

  it('is not asked when RailYatri read fine', () => {
    expect(planCheck(after([CONFIRMTKT, 'ok'], [RAILYATRI, 'ok'])).next).not.toBe(GOIBIBO);
  });

  it('ends the check when ConfirmTkt is fine and neither other source gave a read', () => {
    const steps = after([CONFIRMTKT, 'ok'], [RAILYATRI, 'wrong_run'], [GOIBIBO, 'failed']);
    expect(planCheck(steps).next).toBeNull();
  });

  it('ends the check when ConfirmTkt is fine and Goibibo reads fine after RailYatri was skipped', () => {
    const steps = after([CONFIRMTKT, 'ok'], [RAILYATRI, 'skipped'], [GOIBIBO, 'ok']);
    expect(planCheck(steps).next).toBeNull();
  });
});

describe('planCheck, Travelkhana as the backup that names the run', () => {
  it.each(NOT_OK)('comes in only when ConfirmTkt gave %s', (outcome) => {
    const steps = after([CONFIRMTKT, outcome], [RAILYATRI, 'ok']);
    expect(planCheck(steps).next).toBe(TRAVELKHANA);
  });

  it('is not asked when ConfirmTkt read fine, however the others went', () => {
    const steps = after([CONFIRMTKT, 'ok'], [RAILYATRI, 'failed'], [GOIBIBO, 'failed']);
    expect(planCheck(steps).next).not.toBe(TRAVELKHANA);
  });

  it('comes after Goibibo when both ConfirmTkt and RailYatri gave nothing', () => {
    const steps = after([CONFIRMTKT, 'failed'], [RAILYATRI, 'wrong_run']);
    expect(planCheck(steps).next).toBe(GOIBIBO);
    expect(planCheck([...steps, { source: GOIBIBO, outcome: 'ok' }]).next).toBe(TRAVELKHANA);
  });

  it('ends the check when Travelkhana reads fine and ConfirmTkt did not', () => {
    const steps = after([CONFIRMTKT, 'unavailable'], [RAILYATRI, 'ok'], [TRAVELKHANA, 'ok']);
    expect(planCheck(steps).next).toBeNull();
  });
});

describe('planCheck, Railmitra as the spare', () => {
  const ALL_FAILED = after(
    [CONFIRMTKT, 'failed'],
    [RAILYATRI, 'skipped'],
    [GOIBIBO, 'unavailable'],
    [TRAVELKHANA, 'wrong_run'],
  );

  it('comes in only when every other scrape gave nothing', () => {
    expect(planCheck(ALL_FAILED).next).toBe(RAILMITRA);
  });

  it.each([
    ['ConfirmTkt', after([CONFIRMTKT, 'ok'], [RAILYATRI, 'failed'], [GOIBIBO, 'failed'])],
    ['RailYatri', after([CONFIRMTKT, 'failed'], [RAILYATRI, 'ok'], [TRAVELKHANA, 'failed'])],
    [
      'Goibibo',
      after(
        [CONFIRMTKT, 'failed'],
        [RAILYATRI, 'failed'],
        [GOIBIBO, 'ok'],
        [TRAVELKHANA, 'failed'],
      ),
    ],
    [
      'Travelkhana',
      after(
        [CONFIRMTKT, 'failed'],
        [RAILYATRI, 'failed'],
        [GOIBIBO, 'failed'],
        [TRAVELKHANA, 'ok'],
      ),
    ],
  ])('is not asked when %s read fine', (_name, steps) => {
    expect(planCheck(steps).next).not.toBe(RAILMITRA);
  });

  it('ends the check when the spare has been tried too', () => {
    expect(planCheck([...ALL_FAILED, { source: RAILMITRA, outcome: 'failed' }]).next).toBeNull();
  });
});

describe('planCheck, the sequence as a whole', () => {
  it('never asks a source twice', () => {
    let steps: Tried[] = [];
    const asked: string[] = [];
    for (let guard = 0; guard < 10; guard += 1) {
      const { next } = planCheck(steps);
      if (next === null) {
        break;
      }
      asked.push(next);
      steps = [...steps, { source: next, outcome: 'failed' }];
    }
    expect(asked).toEqual([CONFIRMTKT, RAILYATRI, GOIBIBO, TRAVELKHANA, RAILMITRA]);
    expect(new Set(asked).size).toBe(asked.length);
  });

  it('counts a source by its latest word if it appears more than once', () => {
    const steps = after([CONFIRMTKT, 'failed'], [RAILYATRI, 'ok'], [CONFIRMTKT, 'ok']);
    expect(planCheck(steps).next).toBeNull();
  });

  it('never names RailRadar, which has its own rule', () => {
    const everyone = after(
      [CONFIRMTKT, 'failed'],
      [RAILYATRI, 'failed'],
      [GOIBIBO, 'failed'],
      [TRAVELKHANA, 'failed'],
      [RAILMITRA, 'failed'],
    );
    expect(planCheck(everyone).next).toBeNull();
  });
});
