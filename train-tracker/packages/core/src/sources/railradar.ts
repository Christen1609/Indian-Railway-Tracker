// Features: live response schema, station code aliases, the live parser

import { z } from 'zod';
import { istDateOf, toUtc } from '../time.js';
import type { EventType, IsoDate, RawFetch, SourceEvent } from '../types.js';

const SOURCE = 'railradar';
const OBSERVED = 'observed';
const PREDICTED = 'predicted';
const OK = 200;

/** RailRadar's station code where it differs from the reference data */
const STATION_ALIASES: Record<string, string> = { MMCT: 'BCT' };

const RouteStop = z.object({
  sequence: z.number().int(),
  stationCode: z.string().min(1),
  isHalt: z.boolean(),
  scheduledDeparture: z.string().optional(),
  actualArrival: z.string().optional(),
  actualDeparture: z.string().optional(),
  provenance: z.string().optional(),
});

const LiveResponse = z.object({
  success: z.boolean(),
  data: z.object({
    trainNumber: z.string().min(1),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    route: z.array(RouteStop).min(1),
  }),
});

export type ParseResult = { events: SourceEvent[]; errors: string[]; journeyDate: IsoDate | null };

/** Canonical station code for a RailRadar one */
export function canonicalStationCode(code: string): string {
  return STATION_ALIASES[code] ?? code;
}

/** Events a stop reports, as type and timestamp pairs, before any are confirmed */
function reportedTimes(
  isHalt: boolean,
  actualArrival: string | undefined,
  actualDeparture: string | undefined,
): readonly (readonly [EventType, string | undefined])[] {
  return isHalt
    ? [
        ['ARR', actualArrival],
        ['DEP', actualDeparture],
      ]
    : [['PASS', actualDeparture ?? actualArrival]];
}

/** Events from one RailRadar live response, with every problem found */
export function parseRailRadarLive(raw: RawFetch, rawFetchId: string): ParseResult {
  if (raw.error !== undefined) {
    return { events: [], errors: [`RailRadar fetch failed. ${raw.error}`], journeyDate: null };
  }
  if (raw.status !== OK) {
    return {
      events: [],
      journeyDate: null,
      errors: [`RailRadar returned ${raw.status}. Check RAILRADAR_API_KEY in .env.`],
    };
  }

  let body: unknown;
  try {
    body = JSON.parse(raw.body);
  } catch {
    return { events: [], errors: ['RailRadar body is not JSON.'], journeyDate: null };
  }

  const parsed = LiveResponse.safeParse(body);
  if (!parsed.success) {
    return {
      events: [],
      journeyDate: null,
      errors: parsed.error.issues.map(
        (issue) => `RailRadar response at ${issue.path.join('.')}: ${issue.message}`,
      ),
    };
  }

  const { success, data } = parsed.data;
  if (!success) {
    return { events: [], errors: ['RailRadar reported success false.'], journeyDate: null };
  }

  const events: SourceEvent[] = [];
  const errors: string[] = [];
  const journeyDate = data.startDate;
  const origin = data.route[0];

  if (origin?.scheduledDeparture !== undefined) {
    const departure = toUtc(origin.scheduledDeparture); // UTC instant, from toUtc
    if (departure !== null && istDateOf(departure) !== journeyDate) {
      errors.push(
        `RailRadar startDate ${journeyDate} is not the IST date of the origin departure, ${istDateOf(departure)}.`,
      );
    }
  }

  for (const stop of data.route) {
    const stationCode = canonicalStationCode(stop.stationCode); // canonical code, from canonicalStationCode
    if (stop.provenance === PREDICTED) {
      continue;
    }
    if (stop.provenance !== undefined && stop.provenance !== OBSERVED) {
      errors.push(
        `RailRadar stop ${stop.sequence} ${stationCode} has unknown provenance ${stop.provenance}. Times dropped.`,
      );
      continue;
    }

    // type and timestamp pairs, from reportedTimes
    for (const [type, timestamp] of reportedTimes(
      stop.isHalt,
      stop.actualArrival,
      stop.actualDeparture,
    )) {
      if (timestamp === undefined) {
        continue;
      }
      const at = toUtc(timestamp); // UTC instant, from toUtc
      if (at === null) {
        errors.push(
          `RailRadar stop ${stop.sequence} ${stationCode} ${type} time ${timestamp} has no usable offset.`,
        );
        continue;
      }
      events.push({
        source: SOURCE,
        trainNumber: data.trainNumber,
        journeyDate,
        stationCode,
        type,
        at,
        fetchedAt: raw.fetchedAt,
        rawFetchId,
      });
    }
  }

  return { events, errors, journeyDate };
}
