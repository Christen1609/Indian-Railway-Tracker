// Features: ConfirmTkt row schema, reading the page, the ConfirmTkt live parser, the part of a page worth keeping

import { z } from 'zod';
import { dayMonthToIso, istWallToUtc } from '../time.js';
import { canonicalStationCode } from './stations.js';
import type { ParseResult } from './railradar.js';
import type { EventType, IsoUtc, RawFetch, SourceEvent } from '../types.js';

const SOURCE = 'confirmtkt_scrape';
const OK = 200;
const CODE_SELECT = /<select id="Stationcode"[^>]*>([\s\S]*?)<\/select>/;
const DATE_SELECT = /<select id="selectdate"[^>]*>([\s\S]*?)<\/select>/;
const SELECTED_DATE = /<option[^>]*selected="selected"[^>]*value="(\d{2})-([A-Za-z]{3})-(\d{4})"/;
const OPTION_VALUE = /<option value="([^"]+)"/g;
const ROW_START = '<div class="well well-sm"';
const ROWS_START = 'class="running-status"';
const NAME = /rs__station-name[^>]*>([^<]+)</;
const DAY_DATE = /<span>Day \d+<\/span>(?:&nbsp;|\s)*<span>(\d{1,2})-([A-Za-z]{3})<\/span>/;
const TIME_CELL = /<div class="col-xs-2">\s*<span>([^<]*)<\/span>/g;
const TICK = 'bi-check-circle';
const DISCLAIMER = 'Disclaimer';
const UPDATED = /Last Updated:(?:&nbsp;|\s)*(\d{1,2}) ([A-Za-z]{3}) (\d{4}) (\d{2}:\d{2})/;
const TRAIN_NUMBER = /"TrainNumberString":"(\d+)"/;
const ORIGIN_ORDER = 0;
const FIRST_ARRIVAL = 0;
const FIRST_DEPARTURE = 1;

const Clock = z.string().regex(/^(?:\d{2}:\d{2})?$/);

const Row = z.object({
  name: z.string().min(1),
  day: z.string().regex(/^\d{1,2}$/),
  month: z.string().length(3),
  arrival: Clock,
  departure: Clock,
});

type RowRead = { row: z.infer<typeof Row>; isPassed: boolean };

/** The name and the code of each station in the page's drop-down, in route order */
function haltsIn(html: string): { name: string; code: string }[] {
  const options = CODE_SELECT.exec(html)?.[1] ?? '';
  return [...options.matchAll(OPTION_VALUE)].flatMap((option) => {
    const value = (option[1] ?? '').trim();
    const split = value.lastIndexOf(' ');
    return split < 0
      ? []
      : [{ name: value.slice(0, split).trim(), code: value.slice(split).trim() }];
  });
}

/** Each row of the running status table, with whether it carries the passed tick */
function rowsIn(html: string): { reads: RowRead[]; errors: string[] } {
  const start = html.indexOf(ROWS_START);
  const reads: RowRead[] = [];
  const errors: string[] = [];
  for (const piece of start < 0 ? [] : html.slice(start).split(ROW_START).slice(1)) {
    const name = NAME.exec(piece);
    const date = DAY_DATE.exec(piece);
    const times = [...piece.matchAll(TIME_CELL)].map((cell) => cell[1] ?? '');
    const parsed = Row.safeParse({
      name: name?.[1]?.trim(),
      day: date?.[1],
      month: date?.[2],
      arrival: times[FIRST_ARRIVAL] ?? '',
      departure: times[FIRST_DEPARTURE] ?? '',
    });
    if (!parsed.success) {
      errors.push(
        `ConfirmTkt row ${reads.length + 1}: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')} not readable.`,
      );
      continue;
    }
    reads.push({ row: parsed.data, isPassed: piece.slice(0, name?.index).includes(TICK) });
  }
  return { reads, errors };
}

/** When the page says it was updated, in UTC, or undefined when it says nothing we can read */
function updatedAtOf(body: string): IsoUtc | undefined {
  const parts = UPDATED.exec(body);
  const date =
    parts === null ? null : dayMonthToIso(parts[1] ?? '', parts[2] ?? '', Number(parts[3]));
  return date === null || parts === null
    ? undefined
    : (istWallToUtc(date, parts[4] ?? '') ?? undefined);
}

/** Events from one ConfirmTkt running status page, with every problem found */
export function parseConfirmTktLive(raw: RawFetch, rawFetchId: string): ParseResult {
  const failed = (errors: string[]): ParseResult => ({ events: [], errors, journeyDate: null });
  if (raw.error !== undefined) {
    return failed([`ConfirmTkt fetch failed. ${raw.error}`]);
  }
  if (raw.status !== OK) {
    return failed([`ConfirmTkt returned ${raw.status}.`]);
  }

  const trainNumber = TRAIN_NUMBER.exec(raw.body)?.[1];
  const halts = haltsIn(raw.body);
  const selected = SELECTED_DATE.exec(DATE_SELECT.exec(raw.body)?.[1] ?? '');
  if (trainNumber === undefined || halts.length === 0 || selected === null) {
    return failed(['ConfirmTkt page has no train number, station list or selected date.']);
  }
  const { reads, errors } = rowsIn(raw.body); // the table rows, from rowsIn
  if (errors.length > 0 || reads.length === 0) {
    return failed(errors.length > 0 ? errors : ['ConfirmTkt page has no running status rows.']);
  }

  const byName = new Map(halts.map((halt, haltOrder) => [halt.name, { ...halt, haltOrder }]));
  const matched = reads.filter((read) => byName.has(read.row.name));
  if (matched.length !== halts.length) {
    return failed([
      `ConfirmTkt shows ${matched.length} halt rows for ${halts.length} station codes.`,
    ]);
  }
  const unknown = reads.find((read) => read.isPassed && !byName.has(read.row.name));
  if (unknown !== undefined) {
    return failed([`ConfirmTkt row ${unknown.row.name} is passed but is not in the station list.`]);
  }

  const firstRow = matched[ORIGIN_ORDER]?.row;
  const askedYear = Number(selected[3]);
  const journeyDate =
    firstRow === undefined ? null : dayMonthToIso(firstRow.day, firstRow.month, askedYear);
  if (journeyDate === null) {
    return failed(['ConfirmTkt page has no origin row.']);
  }

  const events: SourceEvent[] = [];
  const problems: string[] = [];
  for (const read of matched) {
    const halt = byName.get(read.row.name);
    if (halt === undefined || !read.isPassed) {
      continue;
    }
    const { day, month } = read.row;
    const sameYear = dayMonthToIso(day, month, askedYear);
    const date =
      sameYear !== null && sameYear < journeyDate
        ? dayMonthToIso(day, month, askedYear + 1)
        : sameYear;
    const reported: readonly (readonly [EventType, string])[] = [
      ['ARR', halt.haltOrder > ORIGIN_ORDER ? read.row.arrival : ''],
      ['DEP', read.row.departure],
    ];
    for (const [type, clock] of reported) {
      if (clock === '') {
        continue;
      }
      const at = date === null ? null : istWallToUtc(date, clock); // UTC instant, from istWallToUtc
      if (at === null) {
        problems.push(`ConfirmTkt ${halt.code} ${type} time ${date} ${clock} is not a real time.`);
        continue;
      }
      events.push({
        source: SOURCE,
        trainNumber,
        journeyDate,
        stationCode: canonicalStationCode(halt.code), // canonical code, from canonicalStationCode
        type,
        at,
        fetchedAt: raw.fetchedAt,
        rawFetchId,
        isHalt: true,
        haltOrder: halt.haltOrder,
      });
    }
  }

  const updatedAt = updatedAtOf(raw.body); // when the page was updated, from updatedAtOf
  return {
    events: problems.length > 0 ? [] : events,
    errors: problems,
    journeyDate,
    ...(updatedAt === undefined ? {} : { updatedAt }),
  };
}

/** A ConfirmTkt page cut down to its train number, station list, date list and status rows, or null when it has no rows */
export function confirmtktTrainData(body: string): string | null {
  const number = TRAIN_NUMBER.exec(body)?.[0];
  const codes = CODE_SELECT.exec(body)?.[0];
  const dates = DATE_SELECT.exec(body)?.[0];
  const start = body.indexOf(ROWS_START);
  const lastRow = body.lastIndexOf(ROW_START);
  const end = body.indexOf(DISCLAIMER, lastRow);
  if (
    number === undefined ||
    codes === undefined ||
    dates === undefined ||
    start < 0 ||
    lastRow < start ||
    end < 0
  ) {
    return null;
  }
  const updated = UPDATED.exec(body)?.[0] ?? '';
  return `<script>{${number}}</script>\n${updated}\n${codes}\n${dates}\n<div ${body.slice(start, end)}`;
}
