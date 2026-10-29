import { describe, expect, it } from 'vitest';
import type { EventType, RejectReason, SourceEvent, SourceId } from '../types.js';
import { TRUST_PRIOR, askedSince, confidenceOf, resolveEvents } from './resolve.js';
import type { SourceRead } from './resolve.js';

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
  return resolveOneWith(events, readsOf(asked));
}

/** Successful reads of these sources, taken when the events were fetched */
function readsOf(asked: readonly SourceId[], fetchedAt: string = RESOLVED_AT): SourceRead[] {
  return asked.map((source) => ({ source, fetchedAt, isSuccess: true }));
}

/** The one event that comes out of resolving with these reads */
function resolveOneWith(events: readonly SourceEvent[], reads: readonly SourceRead[]) {
  const resolved = resolveEvents({
    journeyId: JOURNEY_ID,
    events,
    reads,
    resolvedAt: RESOLVED_AT,
  }); // one event per station and type, from resolveEvents
  expect(resolved.length).toBe(1);
  return resolved[0];
}

const TWO_SOURCES = 2;
const ONE_SOURCE = 1;

describe('confidenceOf', () => {
  it('reads 0.75 and above as high when more than one source agrees', () => {
    expect(confidenceOf(1, TWO_SOURCES)).toBe('high');
    expect(confidenceOf(0.75, TWO_SOURCES)).toBe('high');
  });

  it('reads 0.5 up to 0.75 as medium', () => {
    expect(confidenceOf(0.74, TWO_SOURCES)).toBe('medium');
    expect(confidenceOf(0.5, TWO_SOURCES)).toBe('medium');
  });

  it('reads below 0.5 as low', () => {
    expect(confidenceOf(0.49, TWO_SOURCES)).toBe('low');
    expect(confidenceOf(0, TWO_SOURCES)).toBe('low');
  });

  it('never calls one source alone high, however well it scores', () => {
    expect(confidenceOf(1, ONE_SOURCE)).toBe('medium');
    expect(confidenceOf(0.75, ONE_SOURCE)).toBe('medium');
  });

  it('still calls one source alone low when it scores badly', () => {
    expect(confidenceOf(0.3, ONE_SOURCE)).toBe('low');
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
      name: 'the scrape alone when it was the only source asked scores 1.00 but still reads medium',
      events: [said({ source: 'railyatri_scrape', at: '2026-10-21T15:50:00.000Z' })],
      asked: ['railyatri_scrape'],
      score: 1,
      confidence: 'medium',
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
      reads: readsOf(BOTH),
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

describe('resolveEvents, the single source ceiling DATA_SOURCES.md states', () => {
  it('caps a lone RailRadar confirmation at medium, as seen on the first live run', () => {
    const resolved = resolveOne(
      [said({ source: 'railradar', at: '2026-10-21T15:49:00.000Z' })],
      ['railradar'],
    );
    expect(resolved?.confidenceScore).toBe(1);
    expect(resolved?.confidence).toBe('medium');
    expect(resolved?.sources).toEqual(['railradar']);
  });

  it('lets the same score read high once a second source agrees', () => {
    const resolved = resolveOne([
      said({ source: 'railradar', at: '2026-10-21T15:49:00.000Z' }),
      said({ source: 'railyatri_scrape', at: '2026-10-21T15:50:00.000Z' }),
    ]);
    expect(resolved?.confidence).toBe('high');
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
      reads: readsOf(BOTH),
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

const EARLIER = '2026-10-21T15:00:00.000Z';
const LATER = '2026-10-21T17:00:00.000Z';
const ARRIVED = '2026-10-21T15:49:00.000Z';

describe('askedSince', () => {
  it('counts a successful read at or after the moment, not a failed or earlier one', () => {
    const reads: SourceRead[] = [
      { source: 'railradar', fetchedAt: ARRIVED, isSuccess: true },
      { source: 'railyatri_scrape', fetchedAt: LATER, isSuccess: false },
    ];
    expect(askedSince(ARRIVED, reads)).toEqual(['railradar']);
    expect(askedSince(LATER, reads)).toEqual([]);
  });
});

describe('resolveEvents, over a whole journey', () => {
  it('keeps high when a later check asked only one source', () => {
    const resolved = resolveOneWith(
      [
        said({ source: 'railradar', at: ARRIVED, fetchedAt: RESOLVED_AT }),
        said({ source: 'railyatri_scrape', at: ARRIVED, fetchedAt: RESOLVED_AT }),
        said({ source: 'railyatri_scrape', at: ARRIVED, fetchedAt: LATER }),
      ],
      [...readsOf(BOTH), ...readsOf(['railyatri_scrape'], LATER)],
    );
    expect(resolved?.confidence).toBe('high');
    expect(resolved?.confidenceScore).toBe(1);
  });

  it('never calls two sources of one family high', () => {
    const resolved = resolveEvents({
      journeyId: JOURNEY_ID,
      events: [
        said({ source: 'railradar', at: ARRIVED }),
        said({ source: 'railyatri_scrape', at: ARRIVED }),
      ],
      reads: readsOf(BOTH),
      resolvedAt: RESOLVED_AT,
      families: new Map<SourceId, string>([
        ['railradar', 'one site'],
        ['railyatri_scrape', 'one site'],
      ]),
    });
    expect(resolved[0]?.confidenceScore).toBe(1);
    expect(resolved[0]?.confidence).toBe('medium');
  });

  it('does not count a source read only before the train got there', () => {
    const resolved = resolveOneWith(
      [said({ source: 'railradar', at: ARRIVED })],
      [...readsOf(['railradar']), ...readsOf(['railyatri_scrape'], EARLIER)],
    );
    expect(resolved?.confidenceScore).toBe(1);
  });
});

describe('TRUST_PRIOR', () => {
  it('rates RailRadar at 0.8 and the scrape at 0.5, as DATA_SOURCES.md says', () => {
    expect(TRUST_PRIOR.get('railradar')).toBe(0.8);
    expect(TRUST_PRIOR.get('railyatri_scrape')).toBe(0.5);
  });
});
