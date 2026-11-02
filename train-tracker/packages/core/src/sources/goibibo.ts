// Features: Goibibo page schema, the Goibibo live parser

import { z } from 'zod';
import { istWallToUtc } from '../time.js';
import { canonicalStationCode } from './stations.js';
import type { ParseResult } from './railradar.js';
import type { EventType, IsoDate, RawFetch, SourceEvent } from '../types.js';

const SOURCE = 'goibibo_scrape';
const OK = 200;
const NEXT_DATA = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;
const DAY_MONTH_YEAR = /^(\d{2})-(\d{2})-(\d{4})/;
const ORIGIN_ORDER = 0;
const DATE_LENGTH = 10;

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
          }),
        }),
      }),
    }),
  }),
});

/** An ISO date from Goibibo's day-month-year date */
function isoDateOf(dayMonthYear: string): IsoDate {
  return dayMonthYear.slice(0, DATE_LENGTH).replace(DAY_MONTH_YEAR, '$3-$2-$1');
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

  const parsed = Page.safeParse(json);
  if (!parsed.success) {
    return failed(
      parsed.error.issues.map(
        (issue) => `Goibibo page at ${issue.path.join('.')}: ${issue.message}`,
      ),
    );
  }

  const { TrainDetails, Stations } =
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

  return { events: errors.length > 0 ? [] : events, errors, journeyDate };
}
