import { describe, expect, it } from 'vitest';
import type { EventType, RejectReason, SourceEvent, SourceId } from '../types.js';
import { TRUST_PRIOR, confidenceOf, resolveEvents } from './resolve.js';

const JOURNEY_ID = 'j1';
const JOURNEY_DATE = '2026-10-21';
const RESOLVED_AT = '2026-10-21T16:00:00.000Z';
const BOTH: SourceId[] = ['railradar', 'railyatri_scrape'];

type Said = { source: SourceId; at: string; fetchedAt?: string; rejected?: RejectReason };

/** What one source said about Vadodara, as a normalized event */
function said(one: Said, type: EventType = 'ARR'): SourceEvent {
  return {
    source: one.source,
    trainNumber: '12951',
    journeyDate: JOURNEY_DATE,
    stationCode: 'BRC',
    type,
    at: one.at,
    fetchedAt: one.fetchedAt ?? RESOLVED_AT,
    rawFetchId: 'r1',
    ...(one.rejected === undefined ? {} : { rejected: one.rejected }),
  };
}

/** The one event that comes out of resolving what these sources said */
function resolveOne(events: readonly SourceEvent[], asked: readonly SourceId[] = BOTH) {
  const resolved = resolveEvents({
    journeyId: JOURNEY_ID,
    events,
    asked,
    resolvedAt: RESOLVED_AT,
  }); // one event per station and type, from resolveEvents
  expect(resolved.length).toBe(1);
  return resolved[0];
}

describe('confidenceOf', () => {
  it('reads 0.75 and above as high', () => {
    expect(confidenceOf(1)).toBe('high');
    expect(confidenceOf(0.75)).toBe('high');
  });

  it('reads 0.5 up to 0.75 as medium', () => {
    expect(confidenceOf(0.74)).toBe('medium');
    expect(confidenceOf(0.5)).toBe('medium');
  });

  it('reads below 0.5 as low', () => {
    expect(confidenceOf(0.49)).toBe('low');
    expect(confidenceOf(0)).toBe('low');
  });
});

describe('resolveEvents, against the worked examples in DATA_SOURCES.md', () => {
  const cases: {
    name: string;
    events: SourceEvent[];
    asked?: SourceId[];
    score: number;
    confidence: string;
    chosenSource: SourceId;
    at: string;
  }[] = [
    {
      name: 'both sources agreeing scores 1.00 and reads high',
      events: [
        said({ source: 'railradar', at: '2026-10-21T15:49:00.000Z' }),
        said({ source: 'railyatri_scrape', at: '2026-10-21T15:50:00.000Z' }),
      ],
      score: 1,
      confidence: 'high',
      chosenSource: 'railradar',
      at: '2026-10-21T15:49:00.000Z',
    },
    {
      name: 'RailRadar alone while the scrape says nothing scores 0.62 and reads medium',
      events: [said({ source: 'railradar', at: '2026-10-21T15:49:00.000Z' })],
      score: 0.8 / 1.3,
      confidence: 'medium',
      chosenSource: 'railradar',
      at: '2026-10-21T15:49:00.000Z',
    },
    {
      name: 'the scrape alone while RailRadar was asked scores 0.38 and reads low',
      events: [said({ source: 'railyatri_scrape', at: '2026-10-21T15:50:00.000Z' })],
      score: 0.5 / 1.3,
      confidence: 'low',
      chosenSource: 'railyatri_scrape',
      at: '2026-10-21T15:50:00.000Z',
    },
    {
      name: 'the scrape alone when it was the only source asked scores 1.00',
      events: [said({ source: 'railyatri_scrape', at: '2026-10-21T15:50:00.000Z' })],
      asked: ['railyatri_scrape'],
      score: 1,
      confidence: 'high',
      chosenSource: 'railyatri_scrape',
      at: '2026-10-21T15:50:00.000Z',
    },
  ];

  for (const one of cases) {
    it(one.name, () => {
      const resolved = resolveOne(one.events, one.asked ?? BOTH); // the resolved event, from resolveOne
      expect(resolved?.confidenceScore).toBeCloseTo(one.score, 4);
      expect(resolved?.confidence).toBe(one.confidence);
      expect(resolved?.chosenSource).toBe(one.chosenSource);
      expect(resolved?.at).toBe(one.at);
    });
  }
});

describe('resolveEvents, clustering times', () => {
  it('counts sources 2 min apart as agreeing', () => {
    const resolved = resolveOne([
      said({ source: 'railradar', at: '2026-10-21T15:49:00.000Z' }),
      said({ source: 'railyatri_scrape', at: '2026-10-21T15:51:00.000Z' }),
    ]);
    expect(resolved?.sources).toEqual(['railradar', 'railyatri_scrape']);
    expect(resolved?.confidenceScore).toBeCloseTo(1, 4);
  });

  it('counts sources 3 min apart as disagreeing', () => {
    const resolved = resolveOne([
      said({ source: 'railradar', at: '2026-10-21T15:49:00.000Z' }),
      said({ source: 'railyatri_scrape', at: '2026-10-21T15:52:00.000Z' }),
    ]);
    expect(resolved?.sources).toEqual(['railradar']);
    expect(resolved?.confidenceScore).toBeCloseTo(0.8 / 1.3, 4);
  });

  it('keeps the time of the source it trusts most when they disagree', () => {
    const resolved = resolveOne([
      said({ source: 'railyatri_scrape', at: '2026-10-21T15:40:00.000Z' }),
      said({ source: 'railradar', at: '2026-10-21T15:49:00.000Z' }),
    ]);
    expect(resolved?.at).toBe('2026-10-21T15:49:00.000Z');
    expect(resolved?.chosenSource).toBe('railradar');
  });
});

describe('resolveEvents, what it refuses to count', () => {
  it('never resolves an event the nonsense rules rejected', () => {
    const resolved = resolveEvents({
      journeyId: JOURNEY_ID,
      events: [
        said({ source: 'railradar', at: '2026-10-21T15:49:00.000Z', rejected: 'backwards' }),
      ],
      asked: BOTH,
      resolvedAt: RESOLVED_AT,
    });
    expect(resolved).toEqual([]);
  });

  it('counts a source that re-reports the same stop once, not many times', () => {
    const resolved = resolveOne([
      said({ source: 'railradar', at: '2026-10-21T15:49:00.000Z', fetchedAt: RESOLVED_AT }),
      said({
        source: 'railradar',
        at: '2026-10-21T15:49:00.000Z',
        fetchedAt: '2026-10-21T16:05:00.000Z',
      }),
      said({
        source: 'railradar',
        at: '2026-10-21T15:49:00.000Z',
        fetchedAt: '2026-10-21T16:10:00.000Z',
      }),
    ]);
    expect(resolved?.sources).toEqual(['railradar']);
    expect(resolved?.confidenceScore).toBeCloseTo(0.8 / 1.3, 4);
  });

  it('takes a source at its latest word when it changes its mind', () => {
    const resolved = resolveOne([
      said({ source: 'railradar', at: '2026-10-21T15:49:00.000Z', fetchedAt: RESOLVED_AT }),
      said({
        source: 'railradar',
        at: '2026-10-21T15:58:00.000Z',
        fetchedAt: '2026-10-21T16:10:00.000Z',
      }),
    ]);
    expect(resolved?.at).toBe('2026-10-21T15:58:00.000Z');
  });

  it('never scores above 1, however many sources turn up', () => {
    const resolved = resolveOne(
      [
        said({ source: 'railradar', at: '2026-10-21T15:49:00.000Z' }),
        said({ source: 'railyatri_scrape', at: '2026-10-21T15:49:00.000Z' }),
      ],
      ['railradar'],
    );
    expect(resolved?.confidenceScore).toBe(1);
  });
});

describe('resolveEvents, one event per station and type', () => {
  it('resolves an arrival and a departure at the same station separately', () => {
    const resolved = resolveEvents({
      journeyId: JOURNEY_ID,
      events: [
        said({ source: 'railradar', at: '2026-10-21T15:49:00.000Z' }, 'ARR'),
        said({ source: 'railradar', at: '2026-10-21T15:59:00.000Z' }, 'DEP'),
      ],
      asked: BOTH,
      resolvedAt: RESOLVED_AT,
    });
    expect(resolved.map((one) => one.type)).toEqual(['ARR', 'DEP']);
    expect(resolved.map((one) => one.at)).toEqual([
      '2026-10-21T15:49:00.000Z',
      '2026-10-21T15:59:00.000Z',
    ]);
  });

  it('stamps every resolved event with the journey and the moment it was resolved', () => {
    const resolved = resolveOne([said({ source: 'railradar', at: '2026-10-21T15:49:00.000Z' })]);
    expect(resolved?.journeyId).toBe(JOURNEY_ID);
    expect(resolved?.resolvedAt).toBe(RESOLVED_AT);
  });
});

describe('TRUST_PRIOR', () => {
  it('rates RailRadar at 0.8 and the scrape at 0.5, as DATA_SOURCES.md says', () => {
    expect(TRUST_PRIOR.get('railradar')).toBe(0.8);
    expect(TRUST_PRIOR.get('railyatri_scrape')).toBe(0.5);
  });
});
