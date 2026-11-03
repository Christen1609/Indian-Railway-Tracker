// Features: RailYatri page schema, the RailYatri live parser, the part of a page worth keeping

import { z } from 'zod';
import { istWallToUtc, plusDays } from '../time.js';
import { NEXT_DATA, nextDataPart } from './goibibo.js';
import { canonicalStationCode } from './stations.js';
import type { ParseResult } from './railradar.js';
import type { EventType, RawFetch, SourceEvent } from '../types.js';

const SOURCE = 'railyatri_scrape';
const OK = 200;
const FIRST_STOPPAGE = 1;
const NEXT_DAY = 1;

const Clock = z.string().regex(/^\d{2}:\d{2}$/);

const Passed = z.object({
  station_code: z.string().min(1),
  stoppage_number: z.number().int().min(FIRST_STOPPAGE),
  eta: Clock,
  etd: Clock,
  a_day: z.number().int().nonnegative(),
});

const Page = z.object({
  props: z.object({
    pageProps: z.object({
      ltsData: z.object({
        train_number: z.string().min(1),
        train_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        source: z.string().min(1),
        at_src: z.boolean(),
        previous_stations: z.array(Passed).optional(),
      }),
    }),
  }),
});

/** Events from one RailYatri live page, with every problem found */
export function parseRailYatriLive(raw: RawFetch, rawFetchId: string): ParseResult {
  const failed = (errors: string[]): ParseResult => ({ events: [], errors, journeyDate: null });
  if (raw.error !== undefined) {
    return failed([`RailYatri fetch failed. ${raw.error}`]);
  }
  if (raw.status !== OK) {
    return failed([`RailYatri returned ${raw.status}.`]);
  }

  const block = NEXT_DATA.exec(raw.body)?.[1];
  if (block === undefined) {
    return failed(['RailYatri page has no __NEXT_DATA__ block.']);
  }
  let json: unknown;
  try {
    json = JSON.parse(block);
  } catch {
    return failed(['RailYatri __NEXT_DATA__ is not JSON.']);
  }

  const parsed = Page.safeParse(json);
  if (!parsed.success) {
    return failed(
      parsed.error.issues.map(
        (issue) => `RailYatri page at ${issue.path.join('.')}: ${issue.message}`,
      ),
    );
  }

  const lts = parsed.data.props.pageProps.ltsData;
  const journeyDate = lts.train_start_date;
  if (lts.previous_stations === undefined && !lts.at_src) {
    return failed(['RailYatri page has a train past its origin but no previous_stations.']);
  }

  const events: SourceEvent[] = [];
  const errors: string[] = [];
  for (const stop of lts.previous_stations ?? []) {
    const stationCode = canonicalStationCode(stop.station_code); // canonical code, from canonicalStationCode
    const isOrigin = stop.station_code === lts.source;
    const arrivalDate = plusDays(journeyDate, stop.a_day); // the day the train arrived, from plusDays
    const isPastMidnight = !isOrigin && stop.etd < stop.eta;
    const departureDate = isPastMidnight ? plusDays(arrivalDate, NEXT_DAY) : arrivalDate;
    const reported: readonly (readonly [EventType, string, string, boolean])[] = [
      ['ARR', arrivalDate, stop.eta, !isOrigin],
      ['DEP', departureDate, stop.etd, true],
    ];

    for (const [type, date, clock, isWanted] of reported) {
      if (!isWanted) {
        continue;
      }
      const at = istWallToUtc(date, clock); // UTC instant, from istWallToUtc
      if (at === null) {
        errors.push(`RailYatri stop ${stationCode} ${type} time ${date} ${clock} is not real.`);
        continue;
      }
      events.push({
        source: SOURCE,
        trainNumber: lts.train_number,
        journeyDate,
        stationCode,
        type,
        at,
        fetchedAt: raw.fetchedAt,
        rawFetchId,
        isHalt: true,
        haltOrder: stop.stoppage_number - FIRST_STOPPAGE,
      });
    }
  }

  return { events: errors.length > 0 ? [] : events, errors, journeyDate };
}

/** A RailYatri page cut down to ltsData, or null when it holds none */
export function railyatriTrainData(body: string): string | null {
  return nextDataPart(body, ['props', 'pageProps', 'ltsData']);
}
