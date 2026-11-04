// Features: Goibibo page schema, the Goibibo live parser, the Goibibo timetable parser, the part of a page worth keeping

import { z } from 'zod';
import { MINUTES_PER_DAY, istWallToUtc } from '../time.js';
import { canonicalStationCode } from './stations.js';
import type { ParseResult } from './railradar.js';
import type { EventType, IsoDate, IsoUtc, RawFetch, SourceEvent } from '../types.js';

const SOURCE = 'goibibo_scrape';
const OK = 200;
export const NEXT_DATA = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;
const DAY_MONTH_YEAR = /^(\d{2})-(\d{2})-(\d{4})/;
const ORIGIN_ORDER = 0;
const NO_DATA_CODE = 'TLSV2007';
const NO_DATA_MESSAGE = 'No data';
const DATE_LENGTH = 10;
const UPDATED = /^(\d{2}-\d{2}-\d{4}) (\d{2}:\d{2}):\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MINUTES_PER_HOUR = 60;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

const Stop = z.object({
  Station: z.object({ code: z.string().min(1) }),
  ArrivalDetails: z.object({
    actualArrivalDate: z.string().regex(DAY_MONTH_YEAR),
    actualArrivalTime: z.string(),
    arrived: z.boolean().optional(),
  }),
  DepartureDetails: z.object({
    actualDepartureDate: z.string().regex(DAY_MONTH_YEAR),
    actualDepartureTime: z.string(),
    departed: z.boolean().optional(),
  }),
});

const Page = z.object({
  props: z.object({
    pageProps: z.object({
      initialSeoData: z.object({
        data: z.object({
          liveStatusApiResponse: z.object({
            TrainDetails: z.object({
              Number: z.string().min(1),
              StartDate: z.string().regex(DAY_MONTH_YEAR),
            }),
            Stations: z.array(Stop).min(1),
            LastUpdated: z.string().optional(),
          }),
        }),
      }),
    }),
  }),
});

const NoData = z.object({
  props: z.object({
    pageProps: z.object({
      initialSeoData: z.object({
        data: z.object({
          liveStatusApiResponse: z.object({
            Error: z.object({ code: z.literal(NO_DATA_CODE), message: z.literal(NO_DATA_MESSAGE) }),
          }),
        }),
      }),
    }),
  }),
});

const TimetableHalt = z.object({
  Station: z.object({ name: z.string().min(1), code: z.string().min(1) }),
  ArrivalDetails: z.object({ scheduledArrivalTime: z.string().regex(CLOCK) }),
  DepartureDetails: z.object({ scheduledDepartureTime: z.string().regex(CLOCK) }),
  Location: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
  Distance: z.string().transform(Number).pipe(z.number().finite().nonnegative()),
  Day: z.number().int().positive(),
});

const TimetablePage = z.object({
  props: z.object({
    pageProps: z.object({
      initialSeoData: z.object({
        data: z.object({
          scheduledIntermediateApiResponse: z.object({
            DaysOfRun: z.record(z.string(), z.boolean()).optional(),
            Stations: z.array(TimetableHalt).min(1),
          }),
        }),
      }),
    }),
  }),
});

export type TimetableHaltRead = {
  seq: number;
  stationCode: string;
  name: string;
  lat: number | null;
  lon: number | null;
  schedArrMin: number | null;
  schedDepMin: number | null;
  km: number;
};

export type TimetableParse = {
  halts: TimetableHaltRead[];
  runsOn: number | null;
  errors: string[];
};

/** An ISO date from Goibibo's day-month-year date */
function isoDateOf(dayMonthYear: string): IsoDate {
  return dayMonthYear.slice(0, DATE_LENGTH).replace(DAY_MONTH_YEAR, '$3-$2-$1');
}

/** When the page says it was updated, in UTC, or undefined when it says nothing we can read */
function updatedAtOf(text: string | undefined): IsoUtc | undefined {
  const parts = UPDATED.exec(text ?? '');
  return parts === null
    ? undefined
    : (istWallToUtc(isoDateOf(parts[1] ?? ''), parts[2] ?? '') ?? undefined);
}

/** Events from one Goibibo live page, with every problem found */
export function parseGoibiboLive(raw: RawFetch, rawFetchId: string): ParseResult {
  const failed = (errors: string[]): ParseResult => ({ events: [], errors, journeyDate: null });
  if (raw.error !== undefined) {
    return failed([`Goibibo fetch failed. ${raw.error}`]);
  }
  if (raw.status !== OK) {
    return failed([`Goibibo returned ${raw.status}.`]);
  }

  const block = NEXT_DATA.exec(raw.body)?.[1];
  if (block === undefined) {
    return failed(['Goibibo page has no __NEXT_DATA__ block.']);
  }
  let json: unknown;
  try {
    json = JSON.parse(block);
  } catch {
    return failed(['Goibibo __NEXT_DATA__ is not JSON.']);
  }

  if (NoData.safeParse(json).success) {
    return { events: [], errors: [], journeyDate: null, isUnavailable: true };
  }

  const parsed = Page.safeParse(json);
  if (!parsed.success) {
    return failed(
      parsed.error.issues.map(
        (issue) => `Goibibo page at ${issue.path.join('.')}: ${issue.message}`,
      ),
    );
  }

  const { TrainDetails, Stations, LastUpdated } =
    parsed.data.props.pageProps.initialSeoData.data.liveStatusApiResponse;
  const journeyDate = isoDateOf(TrainDetails.StartDate);
  const events: SourceEvent[] = [];
  const errors: string[] = [];

  Stations.forEach((stop, haltOrder) => {
    const stationCode = canonicalStationCode(stop.Station.code); // canonical code, from canonicalStationCode
    const { ArrivalDetails: arrival, DepartureDetails: departure } = stop;
    const reported: readonly (readonly [EventType, boolean | undefined, string, string])[] = [
      [
        'ARR',
        haltOrder > ORIGIN_ORDER ? arrival.arrived : undefined,
        arrival.actualArrivalDate,
        arrival.actualArrivalTime,
      ],
      ['DEP', departure.departed, departure.actualDepartureDate, departure.actualDepartureTime],
    ];

    for (const [type, isPassed, date, clock] of reported) {
      if (isPassed !== true) {
        continue;
      }
      const at = istWallToUtc(isoDateOf(date), clock); // UTC instant, from istWallToUtc
      if (at === null) {
        errors.push(
          `Goibibo stop ${stationCode} ${type} time ${date} ${clock} is not a real time.`,
        );
        continue;
      }
      events.push({
        source: SOURCE,
        trainNumber: TrainDetails.Number,
        journeyDate,
        stationCode,
        type,
        at,
        fetchedAt: raw.fetchedAt,
        rawFetchId,
        isHalt: true,
        haltOrder,
      });
    }
  });

  const updatedAt = updatedAtOf(LastUpdated); // when the page was updated, from updatedAtOf
  return {
    events: errors.length > 0 ? [] : events,
    errors,
    journeyDate,
    ...(updatedAt === undefined ? {} : { updatedAt }),
  };
}

/** Minutes from midnight IST on day 1 for a clock on a day of the journey */
function minuteOf(day: number, clock: string): number {
  const [hours = 0, minutes = 0] = clock.split(':').map(Number);
  return (day - 1) * MINUTES_PER_DAY + hours * MINUTES_PER_HOUR + minutes;
}

/** The run days as a bitmask with Mon = 1 and Sun = 64, or null when the page lists none */
function runsOnOf(days: Record<string, boolean> | undefined): number | null {
  if (days === undefined || !WEEKDAYS.some((weekday) => weekday in days)) {
    return null;
  }
  return WEEKDAYS.reduce(
    (mask, weekday, bit) => (days[weekday] === true ? mask + 2 ** bit : mask),
    0,
  );
}

/** The timetable halts and run days from one Goibibo page, with every problem found */
export function parseGoibiboTimetable(raw: RawFetch): TimetableParse {
  const failed = (errors: string[]): TimetableParse => ({ halts: [], runsOn: null, errors });
  if (raw.error !== undefined) {
    return failed([`Goibibo fetch failed. ${raw.error}`]);
  }
  if (raw.status !== OK) {
    return failed([`Goibibo returned ${raw.status}.`]);
  }
  const block = NEXT_DATA.exec(raw.body)?.[1];
  if (block === undefined) {
    return failed(['Goibibo page has no __NEXT_DATA__ block.']);
  }
  let json: unknown;
  try {
    json = JSON.parse(block);
  } catch {
    return failed(['Goibibo __NEXT_DATA__ is not JSON.']);
  }
  const parsed = TimetablePage.safeParse(json);
  if (!parsed.success) {
    return failed(
      parsed.error.issues.map(
        (issue) => `Goibibo timetable at ${issue.path.join('.')}: ${issue.message}`,
      ),
    );
  }

  const { Stations, DaysOfRun } =
    parsed.data.props.pageProps.initialSeoData.data.scheduledIntermediateApiResponse;
  const lastSeq = Stations.length - 1;
  const halts: TimetableHaltRead[] = [];
  let previousMin = -1;
  for (const [seq, halt] of Stations.entries()) {
    const arrival = minuteOf(halt.Day, halt.ArrivalDetails.scheduledArrivalTime);
    const sameDayDeparture = minuteOf(halt.Day, halt.DepartureDetails.scheduledDepartureTime);
    const departure =
      sameDayDeparture < arrival ? sameDayDeparture + MINUTES_PER_DAY : sameDayDeparture;
    if (arrival < previousMin) {
      return failed([
        `Goibibo timetable halt ${halt.Station.code} arrives before the halt ahead of it.`,
      ]);
    }
    previousMin = departure;
    halts.push({
      seq,
      stationCode: canonicalStationCode(halt.Station.code), // canonical code, from canonicalStationCode
      name: halt.Station.name,
      lat: halt.Location?.latitude ?? null,
      lon: halt.Location?.longitude ?? null,
      schedArrMin: seq === 0 ? null : arrival,
      schedDepMin: seq === lastSeq ? null : departure,
      km: halt.Distance,
    });
  }
  return { halts, runsOn: runsOnOf(DaysOfRun), errors: [] };
}

/** The part of a __NEXT_DATA__ page at a path, as a page of its own the parser still reads, or null when it is not there */
export function nextDataPart(body: string, path: readonly string[]): string | null {
  const block = NEXT_DATA.exec(body)?.[1];
  let json: unknown;
  try {
    json = block === undefined ? undefined : JSON.parse(block);
  } catch {
    return null;
  }
  let part: unknown = json;
  for (const key of path) {
    part =
      typeof part === 'object' && part !== null
        ? (part as Record<string, unknown>)[key]
        : undefined;
  }
  if (part === undefined) {
    return null;
  }
  const page = path.reduceRight<unknown>((inner, key) => ({ [key]: inner }), part);
  return `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(page)}</script>`;
}

/** A Goibibo page cut down to liveStatusApiResponse, or null when it holds none */
export function goibiboTrainData(body: string): string | null {
  return nextDataPart(body, [
    'props',
    'pageProps',
    'initialSeoData',
    'data',
    'liveStatusApiResponse',
  ]);
}
