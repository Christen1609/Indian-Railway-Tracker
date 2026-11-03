// Features: Railmitra row schema, reading the page, the Railmitra live parser, the part of a page worth keeping

import { z } from 'zod';
import { dayMonthToIso, istWallToUtc } from '../time.js';
import { canonicalStationCode } from './stations.js';
import type { ParseResult } from './railradar.js';
import type { EventType, RawFetch, SourceEvent } from '../types.js';

const SOURCE = 'railmitra_scrape';
const OK = 200;
const ROW_START = '<div class="well well-sm">';
const TRAIN_NUMBER = /<h1><span>(\d+)<\/span> Train Running Status/;
const SELECTED_OPTION = /<option value=\w+ selected=selected>[^<]*<\/option>/;
const CARD_END = '<div class="card cardResult small">';
const HEADING = '<h1><span>';
const SELECTED_DATE = /selected=selected>[^<]*?(\d{1,2})-([A-Za-z]{3})-(\d{4})</;
const HEADER = /<div class=col-12>(Train [A-Za-z ]+?) <strong>/;
const DEPARTED_HEADER = 'Train Departed from';
const ICON = /<span class=(ind-[a-z]+)><i class="fa (fa-[a-z-]+)"/;
const STATION = /<b> ([^<]+?) <\/b> - \(([A-Z0-9]+)\)/;
const DAY_DATE = /<span>Day \d+<\/span> ~<span>\s*(\d{1,2})-([A-Za-z]{3})<\/span>/;
const ARRIVAL_CELL = /col-md-2 text-end"><del[^>]*>([^<]*)<\/del><br><b>([^<]*)<\/b>/;
const DEPARTURE_CELL = /col-md-3 text-end"><del[^>]*>([^<]*)<\/del><br><b>([^<]*)<\/b>/;
const PASSED_ICON = 'fa-check-circle-o';
const CURRENT_ICON = 'fa-circle';
const UPCOMING_ICON = 'fa-circle-thin';
const UNAVAILABLE_TEXT = 'The train status service is experiencing issues';
const SOURCE_LABEL = 'SOURCE';
const DESTINATION_LABEL = 'DESTINATION';
const ORIGIN_ORDER = 0;

const Row = z.object({
  code: z.string().min(1),
  icon: z.enum([PASSED_ICON, CURRENT_ICON, UPCOMING_ICON]),
  day: z.string().regex(/^\d{1,2}$/),
  month: z.string().length(3),
  arrivalLabel: z.string(),
  arrival: z.string().regex(/^\d{2}:\d{2}$/),
  departureLabel: z.string(),
  departure: z.string(),
});

/** Events from one Railmitra running status page, with every problem found */
export function parseRailmitraLive(raw: RawFetch, rawFetchId: string): ParseResult {
  const failed = (errors: string[]): ParseResult => ({ events: [], errors, journeyDate: null });
  if (raw.error !== undefined) {
    return failed([`Railmitra fetch failed. ${raw.error}`]);
  }
  if (raw.status !== OK) {
    return failed([`Railmitra returned ${raw.status}.`]);
  }

  if (raw.body.includes(UNAVAILABLE_TEXT) && !raw.body.includes(ROW_START)) {
    return { events: [], errors: [], journeyDate: null, isUnavailable: true };
  }

  const trainNumber = TRAIN_NUMBER.exec(raw.body)?.[1];
  const selected = SELECTED_DATE.exec(raw.body);
  const pieces = raw.body.split(ROW_START).slice(1);
  if (trainNumber === undefined || selected === null || pieces.length === 0) {
    return failed(['Railmitra page has no train number, selected date or station rows.']);
  }

  const rows: z.infer<typeof Row>[] = [];
  const errors: string[] = [];
  for (const [index, piece] of pieces.entries()) {
    const icon = ICON.exec(piece);
    const station = STATION.exec(piece);
    const date = DAY_DATE.exec(piece);
    const arrival = ARRIVAL_CELL.exec(piece);
    const departure = DEPARTURE_CELL.exec(piece);
    const parsed = Row.safeParse({
      code: station?.[2],
      icon: icon?.[2],
      day: date?.[1],
      month: date?.[2],
      arrivalLabel: arrival?.[1]?.trim(),
      arrival: arrival?.[2],
      departureLabel: departure?.[1]?.trim(),
      departure: departure?.[2],
    });
    if (parsed.success) {
      rows.push(parsed.data);
    } else {
      errors.push(`Railmitra row ${index + 1} is not readable.`);
    }
  }

  const hasCurrent = rows.some((row) => row.icon === CURRENT_ICON);
  const header = HEADER.exec(raw.body)?.[1];
  if (hasCurrent && header !== DEPARTED_HEADER) {
    errors.push(`Railmitra shows a current station under an unrecognised status ${header}.`);
  }
  const origin = rows[ORIGIN_ORDER];
  const askedYear = Number(selected[3]);
  const journeyDate =
    origin === undefined ? null : dayMonthToIso(origin.day, origin.month, askedYear);
  if (errors.length > 0 || origin === undefined || journeyDate === null) {
    return failed(errors.length > 0 ? errors : ['Railmitra page has no readable origin row.']);
  }

  const events: SourceEvent[] = [];
  for (const [haltOrder, row] of rows.entries()) {
    if (row.icon === UPCOMING_ICON) {
      continue;
    }
    const sameYear = dayMonthToIso(row.day, row.month, askedYear);
    const date =
      sameYear !== null && sameYear < journeyDate
        ? dayMonthToIso(row.day, row.month, askedYear + 1)
        : sameYear;
    const reported: readonly (readonly [EventType, string, boolean])[] = [
      ['ARR', row.arrival, row.arrivalLabel !== SOURCE_LABEL],
      ['DEP', row.departure, row.departureLabel !== DESTINATION_LABEL],
    ];
    for (const [type, clock, isWanted] of reported) {
      if (!isWanted) {
        continue;
      }
      const at = date === null ? null : istWallToUtc(date, clock); // UTC instant, from istWallToUtc
      if (at === null) {
        errors.push(`Railmitra ${row.code} ${type} time ${clock} is not a real time.`);
        continue;
      }
      events.push({
        source: SOURCE,
        trainNumber,
        journeyDate,
        stationCode: canonicalStationCode(row.code), // canonical code, from canonicalStationCode
        type,
        at,
        fetchedAt: raw.fetchedAt,
        rawFetchId,
        isHalt: true,
        haltOrder,
      });
    }
  }

  return { events: errors.length > 0 ? [] : events, errors, journeyDate };
}

/** A Railmitra page cut down to its date, heading and station rows, or null when it has none */
export function railmitraTrainData(body: string): string | null {
  const option = SELECTED_OPTION.exec(body)?.[0];
  const start = body.indexOf(HEADING);
  const lastRow = body.lastIndexOf(ROW_START);
  const end = body.indexOf(CARD_END, lastRow);
  if (option === undefined || start < 0 || lastRow < start || end < 0) {
    return null;
  }
  return `${option}\n${body.slice(start, end)}`;
}
