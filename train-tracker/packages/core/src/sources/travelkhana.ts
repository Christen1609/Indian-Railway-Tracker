// Features: Travelkhana row schema, finding one run on the page, the Travelkhana live parser

import { z } from 'zod';
import { dayMonthToIso, istWallToUtc, plusDays } from '../time.js';
import { canonicalStationCode } from './stations.js';
import type { ParseResult } from './railradar.js';
import type { EventType, IsoDate, RawFetch, SourceEvent } from '../types.js';

const SOURCE = 'travelkhana_scrape';
const OK = 200;
const BLOCK_START = "<span class='dept-head'>Current Station";
const START_DATE = /Start Date\s*<\/span>\s*<span>(\d{1,2}) ([A-Za-z]{3}) (\d{4})<\/span>/;
const TRAIN_NUMBER = /track-train\/(\d+)-/;
const ROW = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
const CELL = /<td>([\s\S]*?)<\/td>/g;
const FIRST_SPAN = /<span[^>]*>([^<]*)<\/span>/;
const CLOCK = /^\d{2}:\d{2}$/;
const PASSED = ['Departed', 'Arrived'];
const UPCOMING = /^(?:On Time|Late by (?:\d+hr )?\d+ ?min)$/;
const ORIGIN_ORDER = 0;
const CELLS_PER_ROW = 7;
const FIRST_DAY = 1;

const Pair = z
  .string()
  .regex(/^(?:\d{2}:\d{2}|--|Origin|Destination)\/(?:\d{2}:\d{2}|--|Origin|Destination)$/);

const Row = z.object({
  code: z.string().regex(/^[A-Z0-9]+$/),
  arrival: Pair,
  departure: Pair,
  status: z.string().min(1),
  day: z.string().regex(/^\d+$/),
});

/** The text of an HTML cell, without its tags */
function textOf(cell: string): string {
  return cell.replace(/<[^>]+>/g, '').trim();
}

/** The part of a page that describes the run starting on a date, or null when it is not listed */
function runBlock(html: string, journeyDate: IsoDate): string | null {
  const found = html
    .split(BLOCK_START)
    .slice(1)
    .find((block) => {
      const start = START_DATE.exec(block);
      return (
        start !== null &&
        dayMonthToIso(start[1] ?? '', start[2] ?? '', Number(start[3])) === journeyDate
      );
    });
  return found ?? null;
}

/** Events from the run of one date on a Travelkhana page, which lists the last 8 runs */
export function parseTravelkhanaLive(
  raw: RawFetch,
  rawFetchId: string,
  journeyDate: IsoDate,
): ParseResult {
  const failed = (errors: string[]): ParseResult => ({ events: [], errors, journeyDate: null });
  if (raw.error !== undefined) {
    return failed([`Travelkhana fetch failed. ${raw.error}`]);
  }
  if (raw.status !== OK) {
    return failed([`Travelkhana returned ${raw.status}.`]);
  }

  const trainNumber = TRAIN_NUMBER.exec(raw.body)?.[1];
  if (trainNumber === undefined || !raw.body.includes(BLOCK_START)) {
    return failed(['Travelkhana page has no train number or no run table.']);
  }
  const block = runBlock(raw.body, journeyDate); // the asked run, from runBlock
  if (block === null) {
    return { events: [], errors: [], journeyDate: null };
  }

  const events: SourceEvent[] = [];
  const errors: string[] = [];
  let haltOrder = 0;
  for (const [, rowHtml] of block.matchAll(ROW)) {
    const cells = [...(rowHtml ?? '').matchAll(CELL)].map((cell) => cell[1] ?? '');
    if (cells.length < CELLS_PER_ROW) {
      continue;
    }
    const station = textOf(cells[0] ?? '');
    const parsed = Row.safeParse({
      code: /\(([A-Z0-9]+)\)$/.exec(station)?.[1],
      arrival: textOf(cells[1] ?? ''),
      departure: textOf(cells[2] ?? ''),
      status: FIRST_SPAN.exec(cells[4] ?? '')?.[1]?.trim(),
      day: textOf(cells[5] ?? ''),
    });
    if (!parsed.success) {
      errors.push(`Travelkhana row ${haltOrder + 1} (${station}) is not readable.`);
      haltOrder += 1;
      continue;
    }
    const { code, arrival, departure, status, day } = parsed.data;
    const order = haltOrder;
    haltOrder += 1;
    if (!PASSED.includes(status)) {
      if (!UPCOMING.test(status)) {
        errors.push(`Travelkhana row ${code} has an unrecognised status ${status}.`);
      }
      continue;
    }

    const date = plusDays(journeyDate, Number(day) - FIRST_DAY); // the day the row falls on, from plusDays
    const reported: readonly (readonly [EventType, string, boolean])[] = [
      ['ARR', arrival, order > ORIGIN_ORDER],
      ['DEP', departure, status === 'Departed'],
    ];
    for (const [type, pair, isWanted] of reported) {
      if (!isWanted) {
        continue;
      }
      const clock = pair.split('/')[0] ?? '';
      const at = CLOCK.test(clock) ? istWallToUtc(date, clock) : null; // UTC instant, from istWallToUtc
      if (at === null) {
        errors.push(`Travelkhana row ${code} ${type} time ${clock} is not a real time.`);
        continue;
      }
      events.push({
        source: SOURCE,
        trainNumber,
        journeyDate,
        stationCode: canonicalStationCode(code), // canonical code, from canonicalStationCode
        type,
        at,
        fetchedAt: raw.fetchedAt,
        rawFetchId,
        isHalt: true,
        haltOrder: order,
      });
    }
  }

  return { events: errors.length > 0 ? [] : events, errors, journeyDate };
}
