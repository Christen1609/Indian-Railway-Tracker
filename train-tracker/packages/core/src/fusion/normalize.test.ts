import { describe, expect, it } from 'vitest';
import { canonicalCode, normalizeEvents } from './normalize.js';
import type { NormalizeContext } from './normalize.js';
import type { Confidence, EventType, RejectReason, ResolvedEvent, SourceEvent } from '../types.js';

const JOURNEY_DATE = '2026-10-21';

const STOPS = [
  { seq: 0, stationCode: 'BCT', km: 0, schedArrMin: null, schedDepMin: 1020 },
  { seq: 1, stationCode: 'BVI', km: 30, schedArrMin: 1040, schedDepMin: 1042 },
  { seq: 2, stationCode: 'ST', km: 263.6, schedArrMin: 1183, schedDepMin: 1188 },
  { seq: 3, stationCode: 'BRC', km: 393.2, schedArrMin: 1266, schedDepMin: 1276 },
  { seq: 4, stationCode: 'RTM', km: 653.6, schedArrMin: 1465, schedDepMin: 1468 },
  { seq: 5, stationCode: 'NAD', km: 697.4, schedArrMin: 1508, schedDepMin: 1510 },
  { seq: 6, stationCode: 'KOTA', km: 922.8, schedArrMin: 1635, schedDepMin: 1640 },
  { seq: 7, stationCode: 'NDLS', km: 1388.4, schedArrMin: 1952, schedDepMin: null },
].map((stop) => ({ ...stop, trainNumber: '12951' }));

const BVI_SEQ = 1;
const SEEN_PACE = 0.84;

/** 12951 with BVI's departure missing, so no section chains out of it */
const UNCHAINED_STOPS = STOPS.map((stop) =>
  stop.stationCode === 'BVI' ? { ...stop, schedDepMin: null } : stop,
);

/** One source event, reported at the moment it was fetched unless said otherwise */
function ev(stationCode: string, type: EventType, at: string, fetchedAt?: string): SourceEvent {
  return {
    source: 'railradar',
    trainNumber: '12951',
    journeyDate: JOURNEY_DATE,
    stationCode,
    type,
    at,
    fetchedAt: fetchedAt ?? at,
    rawFetchId: 'raw-1',
  };
}

/** One already resolved event, as the resolver would have left it */
function confirm(
  stationCode: string,
  type: EventType,
  at: string,
  confidence: Confidence,
): ResolvedEvent {
  return {
    journeyId: 'j1',
    stationCode,
    type,
    at,
    confidenceScore: confidence === 'high' ? 1 : 0.6,
    confidence,
    chosenSource: 'railradar',
    sources: ['railradar'],
    resolvedAt: at,
  };
}

/** The 12951 context, with any part of it replaced */
function ctx(over: Partial<NormalizeContext> = {}): NormalizeContext {
  return {
    journeyDate: JOURNEY_DATE,
    stops: STOPS,
    topSpeedKmh: 130,
    confirmed: [],
    ...over,
  };
}

type Case = {
  proves: string;
  events: SourceEvent[];
  context: NormalizeContext;
  rejected: (RejectReason | undefined)[];
};

const CASES: Case[] = [
  {
    proves: 'an arrival that breaks no rule survives',
    events: [ev('BVI', 'ARR', '2026-10-21T12:06:18.000Z', '2026-10-21T12:10:00.000Z')],
    context: ctx(),
    rejected: [undefined],
  },
  {
    proves: 'a station that this train never calls at is off_route',
    events: [ev('PUNE', 'ARR', '2026-10-21T12:06:18.000Z', '2026-10-21T12:10:00.000Z')],
    context: ctx(),
    rejected: ['off_route'],
  },
  {
    proves: 'a lowercase padded code resolves to the canonical one and survives',
    events: [ev('  bvi  ', 'ARR', '2026-10-21T12:06:18.000Z', '2026-10-21T12:10:00.000Z')],
    context: ctx(),
    rejected: [undefined],
  },
  {
    proves: 'a report more than a minute after the fetch is future_time',
    events: [ev('BVI', 'ARR', '2026-10-21T12:12:00.000Z', '2026-10-21T12:10:00.000Z')],
    context: ctx(),
    rejected: ['future_time'],
  },
  {
    proves: 'exactly a minute of clock drift is allowed',
    events: [ev('BVI', 'ARR', '2026-10-21T12:11:00.000Z', '2026-10-21T12:10:00.000Z')],
    context: ctx(),
    rejected: [undefined],
  },
  {
    proves: 'a parser that forgot the IST offset is caught as future_time',
    events: [ev('BVI', 'ARR', '2026-10-21T17:36:18.000Z', '2026-10-21T12:10:00.000Z')],
    context: ctx(),
    rejected: ['future_time'],
  },
  {
    proves: 'more than 30 min before timetabled origin departure is before_start',
    events: [ev('BVI', 'ARR', '2026-10-21T10:50:00.000Z', '2026-10-21T11:00:00.000Z')],
    context: ctx(),
    rejected: ['before_start'],
  },
  {
    proves: 'exactly 30 min before origin departure is allowed',
    events: [ev('BVI', 'ARR', '2026-10-21T11:00:00.000Z', '2026-10-21T11:05:00.000Z')],
    context: ctx(),
    rejected: [undefined],
  },
  {
    proves: 'a departure earlier than the arrival at the same station is dep_before_arr',
    events: [
      ev('BVI', 'ARR', '2026-10-21T12:06:18.000Z', '2026-10-21T12:10:00.000Z'),
      ev('BVI', 'DEP', '2026-10-21T12:05:00.000Z', '2026-10-21T12:10:00.000Z'),
    ],
    context: ctx(),
    rejected: [undefined, 'dep_before_arr'],
  },
  {
    proves: 'a departure after its arrival survives',
    events: [
      ev('BVI', 'ARR', '2026-10-21T12:06:18.000Z', '2026-10-21T12:10:00.000Z'),
      ev('BVI', 'DEP', '2026-10-21T12:07:29.000Z', '2026-10-21T12:10:00.000Z'),
    ],
    context: ctx(),
    rejected: [undefined, undefined],
  },
  {
    proves: 'an event timed after a high confidence arrival further down the route is backwards',
    events: [ev('BVI', 'ARR', '2026-10-22T03:30:00.000Z', '2026-10-22T03:35:00.000Z')],
    context: ctx({ confirmed: [confirm('NDLS', 'ARR', '2026-10-22T02:57:47.000Z', 'high')] }),
    rejected: ['backwards'],
  },
  {
    proves: 'a re-reported past stop survives, because it is timed before the confirmation',
    events: [ev('BVI', 'ARR', '2026-10-21T12:06:18.000Z', '2026-10-22T03:00:00.000Z')],
    context: ctx({ confirmed: [confirm('NDLS', 'ARR', '2026-10-22T02:57:47.000Z', 'high')] }),
    rejected: [undefined],
  },
  {
    proves: 'the backwards rule ignores a confirmation that is not high confidence',
    events: [ev('BVI', 'ARR', '2026-10-21T18:00:00.000Z', '2026-10-21T18:05:00.000Z')],
    context: ctx({ confirmed: [confirm('ST', 'ARR', '2026-10-21T14:06:18.000Z', 'medium')] }),
    rejected: [undefined],
  },
  {
    proves: 'a jump needing more than the top speed since the last confirmation is too_fast',
    events: [ev('NDLS', 'ARR', '2026-10-21T12:36:18.000Z', '2026-10-21T12:40:00.000Z')],
    context: ctx({ confirmed: [confirm('BVI', 'ARR', '2026-10-21T12:06:18.000Z', 'high')] }),
    rejected: ['too_fast'],
  },
  {
    proves: 'a jump the train could actually make survives',
    events: [ev('ST', 'ARR', '2026-10-21T14:11:18.000Z', '2026-10-21T14:15:00.000Z')],
    context: ctx({ confirmed: [confirm('BVI', 'ARR', '2026-10-21T12:06:18.000Z', 'high')] }),
    rejected: [undefined],
  },
  {
    proves: "a jump inside the rated top speed but outside the section's own cap is too_fast",
    events: [ev('ST', 'ARR', '2026-10-21T14:06:18.000Z', '2026-10-21T14:10:00.000Z')],
    context: ctx({ confirmed: [confirm('BVI', 'ARR', '2026-10-21T12:06:18.000Z', 'high')] }),
    rejected: ['too_fast'],
  },
  {
    proves: 'a learned cap from a section we have seen run that fast lets the same jump through',
    events: [ev('ST', 'ARR', '2026-10-21T14:06:18.000Z', '2026-10-21T14:10:00.000Z')],
    context: ctx({
      learnedCaps: new Map([[BVI_SEQ, SEEN_PACE]]),
      confirmed: [confirm('BVI', 'ARR', '2026-10-21T12:06:18.000Z', 'high')],
    }),
    rejected: [undefined],
  },
  {
    proves: 'the timetable alone catches an impossible jump, with no recorded top speed at all',
    events: [ev('NDLS', 'ARR', '2026-10-21T12:36:18.000Z', '2026-10-21T12:40:00.000Z')],
    context: ctx({
      topSpeedKmh: null,
      confirmed: [confirm('BVI', 'ARR', '2026-10-21T12:06:18.000Z', 'high')],
    }),
    rejected: ['too_fast'],
  },
  {
    proves: 'with no cap to be had, the rated top speed still catches an impossible jump',
    events: [ev('NDLS', 'ARR', '2026-10-21T12:36:18.000Z', '2026-10-21T12:40:00.000Z')],
    context: ctx({
      stops: UNCHAINED_STOPS,
      confirmed: [confirm('BVI', 'ARR', '2026-10-21T12:06:18.000Z', 'high')],
    }),
    rejected: ['too_fast'],
  },
  {
    proves: 'the pace rule is skipped entirely when neither a cap nor a top speed is known',
    events: [ev('ST', 'ARR', '2026-10-21T14:06:18.000Z', '2026-10-21T14:10:00.000Z')],
    context: ctx({
      stops: UNCHAINED_STOPS,
      topSpeedKmh: null,
      confirmed: [confirm('BVI', 'ARR', '2026-10-21T12:06:18.000Z', 'high')],
    }),
    rejected: [undefined],
  },
  {
    proves: 'a time with no offset never became UTC and is bad_format',
    events: [ev('BVI', 'ARR', '2026-10-21T17:36:18', '2026-10-21T12:10:00.000Z')],
    context: ctx(),
    rejected: ['bad_format'],
  },
  {
    proves: 'an unreadable report time is bad_format',
    events: [ev('BVI', 'ARR', 'yesterday evening', '2026-10-21T12:10:00.000Z')],
    context: ctx(),
    rejected: ['bad_format'],
  },
  {
    proves: 'an unreadable fetch time is bad_format, since no rule can be checked against it',
    events: [ev('BVI', 'ARR', '2026-10-21T12:06:18.000Z', 'just now')],
    context: ctx(),
    rejected: ['bad_format'],
  },
];

describe('normalizeEvents', () => {
  for (const { proves, events, context, rejected } of CASES) {
    it(proves, () => {
      expect(normalizeEvents(events, context).map((event) => event.rejected)).toEqual(rejected);
    });
  }

  it('returns every event it was given, so nothing is silently lost', () => {
    const events = CASES.flatMap((one) => one.events);
    expect(normalizeEvents(events, ctx()).length).toBe(events.length);
  });

  it('rewrites the station code on the events it returns', () => {
    const [event] = normalizeEvents([ev('  bvi  ', 'ARR', '2026-10-21T12:06:18.000Z')], ctx());
    expect(event?.stationCode).toBe('BVI');
  });

  it('leaves a surviving event otherwise untouched', () => {
    const one = ev('BVI', 'ARR', '2026-10-21T12:06:18.000Z', '2026-10-21T12:10:00.000Z');
    expect(normalizeEvents([one], ctx())).toEqual([one]);
  });

  it('covers all seven reject reasons', () => {
    expect(
      new Set(CASES.flatMap((one) => one.rejected).filter((one) => one !== undefined)),
    ).toEqual(
      new Set([
        'off_route',
        'future_time',
        'before_start',
        'dep_before_arr',
        'backwards',
        'too_fast',
        'bad_format',
      ]),
    );
  });
});

describe('canonicalCode', () => {
  it('trims and uppercases', () => {
    expect(canonicalCode('  bvi  ')).toBe('BVI');
  });

  it('leaves a code that is already canonical alone', () => {
    expect(canonicalCode('NDLS')).toBe('NDLS');
  });
});
