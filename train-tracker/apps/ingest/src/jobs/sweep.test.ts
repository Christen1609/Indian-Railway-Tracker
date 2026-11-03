import { beforeEach, describe, expect, it, vi } from 'vitest';
import { plusMinutes, timetableMinuteToUtc } from '@train-tracker/core/time';
import type { ResolvedEvent } from '@train-tracker/core/types';
import type { Config } from '../config.js';
import {
  clearBodiesFor,
  deleteDerivedFor,
  markCleaned,
  resolvedFor,
  saveSectionCaps,
  sectionCapsFor,
  timetableFor,
  uncleanedJourneys,
} from '../db/journey-data.js';
import { openIssue } from '../adapters/issues.js';
import { sweepJourneys } from './sweep.js';

vi.mock('../db/journey-data.js');
vi.mock('../log.js');
vi.mock('../adapters/issues.js');

const JOURNEY_DATE = '2026-10-27';
const JOURNEY = { id: 'j1', trainNumber: '12951', journeyDate: JOURNEY_DATE };
const CONFIG = {
  db: { url: 'http://db', serviceRoleKey: 'k' },
  retentionHours: 24,
  issues: { token: 'token', repository: 'owner/repo' },
} as unknown as Config;
const STOPS = [
  { trainNumber: '12951', seq: 0, stationCode: 'BCT', schedArrMin: null, schedDepMin: 1020, km: 0 },
  {
    trainNumber: '12951',
    seq: 1,
    stationCode: 'NDLS',
    schedArrMin: 1952,
    schedDepMin: null,
    km: 1384,
  },
];
const ARRIVAL = timetableMinuteToUtc(JOURNEY_DATE, 1952);
const DUE = plusMinutes(ARRIVAL, 3 * 60 + 24 * 60);
const COOLING = plusMinutes(ARRIVAL, 3 * 60 + 60);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(uncleanedJourneys).mockResolvedValue([JOURNEY]);
  vi.mocked(timetableFor).mockResolvedValue(STOPS);
  vi.mocked(resolvedFor).mockResolvedValue([]);
  vi.mocked(sectionCapsFor).mockResolvedValue([]);
});

describe('sweepJourneys', () => {
  it('clears the bodies, deletes what was derived and marks a journey cleaned once it has cooled', async () => {
    await sweepJourneys(CONFIG, DUE);

    expect(clearBodiesFor).toHaveBeenCalledWith('j1', CONFIG.db);
    expect(saveSectionCaps).toHaveBeenCalledTimes(1);
    expect(deleteDerivedFor).toHaveBeenCalledWith('j1', CONFIG.db);
    expect(markCleaned).toHaveBeenCalledWith('j1', DUE, CONFIG.db);
  });

  it('cleans a journey with no graded windows the same way, so its data does not stay forever', async () => {
    await sweepJourneys(CONFIG, DUE);
    expect(markCleaned).toHaveBeenCalledTimes(1);
    expect(deleteDerivedFor).toHaveBeenCalledTimes(1);
  });

  it('touches nothing while a journey is still cooling', async () => {
    await sweepJourneys(CONFIG, COOLING);
    expect(clearBodiesFor).not.toHaveBeenCalled();
    expect(deleteDerivedFor).not.toHaveBeenCalled();
    expect(markCleaned).not.toHaveBeenCalled();
  });

  it('touches nothing for a journey still running', async () => {
    await sweepJourneys(CONFIG, timetableMinuteToUtc(JOURNEY_DATE, 1700));
    expect(markCleaned).not.toHaveBeenCalled();
  });

  it('clears the bodies before it deletes what was derived', async () => {
    await sweepJourneys(CONFIG, DUE);
    expect(vi.mocked(clearBodiesFor).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deleteDerivedFor).mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('sweeps each journey on its own', async () => {
    vi.mocked(uncleanedJourneys).mockResolvedValue([
      JOURNEY,
      { id: 'j2', trainNumber: '12951', journeyDate: '2026-10-26' },
    ]);
    await sweepJourneys(CONFIG, DUE);
    expect(markCleaned).toHaveBeenCalledTimes(2);
  });
});

describe('sweepJourneys, thin trips', () => {
  const ARRIVED = {
    journeyId: 'j1',
    stationCode: 'NDLS',
    type: 'ARR',
    at: ARRIVAL,
    confidenceScore: 80,
    confidence: 'high',
    chosenSource: 'railradar',
    sources: ['railradar'],
    resolvedAt: ARRIVAL,
  } satisfies ResolvedEvent;

  it('opens a thin-trip issue, before it deletes what was derived, when no arrival was confirmed', async () => {
    await sweepJourneys(CONFIG, DUE);

    expect(vi.mocked(openIssue).mock.calls[0]?.[0]).toMatchObject({
      title: 'Thin trip: 12951 2026-10-27',
      body: 'Arrivals confirmed: 0 of 1',
    });
    expect(vi.mocked(openIssue).mock.calls[0]?.[1]).toBe(CONFIG.issues);
    expect(vi.mocked(openIssue).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deleteDerivedFor).mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('opens nothing for a trip with at least half its arrivals', async () => {
    vi.mocked(resolvedFor).mockResolvedValue([ARRIVED]);
    await sweepJourneys(CONFIG, DUE);
    expect(openIssue).not.toHaveBeenCalled();
  });

  it('opens nothing for a journey that is still cooling or running', async () => {
    await sweepJourneys(CONFIG, COOLING);
    await sweepJourneys(CONFIG, timetableMinuteToUtc(JOURNEY_DATE, 1700));
    expect(openIssue).not.toHaveBeenCalled();
  });
});
