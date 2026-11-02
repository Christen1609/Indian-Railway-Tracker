// Features: the raw fetch row, the insert, the reads of a journey, what the scrape gate reads

import { z } from 'zod';
import { SCRAPE_SOURCES } from '@train-tracker/core/schedule/scrape-gate';
import type { RobotsCache } from '@train-tracker/core/schedule/robots';
import { istDateOf, timetableMinuteToUtc } from '@train-tracker/core/time';
import type { IsoUtc, RawFetch, SourceId } from '@train-tracker/core/types';
import type { SourceRead } from '@train-tracker/core/fusion/resolve';
import { countRows, readAllRows, readRows, writeRows } from './rest.js';
import type { DbConfig } from './rest.js';

const HTTP_OK = 200;

const ReadRows = z.array(
  z.object({
    source: z.string().min(1),
    status: z.number().int(),
    error: z.string().nullable(),
    fetched_at: z.string().min(1),
  }),
);

const Inserted = z.array(z.object({ id: z.string().min(1) }));

export type RawFetchRow = {
  journey_id: string | null;
  source: string;
  url: string;
  status: number;
  body: string | null;
  error: string | null;
  fetched_at: string;
  latency_ms: number;
};

/** The raw_fetches row for one response, whatever that response was */
export function rawFetchRow(raw: RawFetch, journeyId: string | null): RawFetchRow {
  return {
    journey_id: journeyId,
    source: raw.source,
    url: raw.url,
    status: raw.status,
    body: raw.body === '' ? null : raw.body,
    error: raw.error ?? null,
    fetched_at: raw.fetchedAt,
    latency_ms: raw.latencyMs,
  };
}

/** Saves one row and returns the id that source events will point at */
export async function insertRawFetch(row: RawFetchRow, config: DbConfig): Promise<string> {
  // rows, from writeRows
  const inserted = Inserted.safeParse(await writeRows('raw_fetches?select=id', row, config));
  const first = inserted.success ? inserted.data[0] : undefined;
  if (first === undefined) {
    throw new Error('Insert into raw_fetches returned no id. Check the Prefer header and RLS.');
  }
  return first.id;
}

/** Every read of a journey so far, whether it succeeded or not */
export async function readsFor(journeyId: string, config: DbConfig): Promise<SourceRead[]> {
  const query = `raw_fetches?journey_id=eq.${journeyId}&select=source,status,error,fetched_at&order=fetched_at.asc,id.asc`;
  const rows = ReadRows.parse(await readAllRows(query, config)); // rows, from readAllRows
  return rows.map((row) => ({
    source: row.source as SourceId,
    fetchedAt: row.fetched_at,
    isSuccess: row.status === HTTP_OK && row.error === null,
  }));
}

const ScrapeTimes = z.array(z.object({ fetched_at: z.string().min(1) }));

const RobotsRows = z.array(
  z.object({
    status: z.number().int(),
    body: z.string().nullable(),
    error: z.string().nullable(),
    fetched_at: z.string().min(1),
  }),
);

export type ScrapeState = {
  lastAnyAt: IsoUtc | null;
  lastUrlAt: IsoUtc | null;
  fetchedToday: number;
};

const NEWEST_FIRST = 'select=fetched_at&order=fetched_at.desc&limit=1';
const MIDNIGHT = 0;

/** The three queries that tell the gate what the scrape sites have been asked, newest first */
export function scrapeStateQueries(
  url: string,
  now: IsoUtc,
): { lastAny: string; lastUrl: string; today: string } {
  const sources = `source=in.(${SCRAPE_SOURCES.join(',')})`;
  const dayStart = timetableMinuteToUtc(istDateOf(now), MIDNIGHT); // midnight IST, from timetableMinuteToUtc
  return {
    lastAny: `raw_fetches?${sources}&${NEWEST_FIRST}`,
    lastUrl: `raw_fetches?${sources}&url=eq.${encodeURIComponent(url)}&${NEWEST_FIRST}`,
    today: `raw_fetches?${sources}&fetched_at=gte.${dayStart}`,
  };
}

/** What the scrape sites have been asked, from raw_fetches, so the gate needs no table of its own */
export async function scrapeStateFor(
  url: string,
  now: IsoUtc,
  config: DbConfig,
): Promise<ScrapeState> {
  const queries = scrapeStateQueries(url, now); // the three queries, from scrapeStateQueries
  const [lastAny, lastUrl, fetchedToday] = await Promise.all([
    readRows(queries.lastAny, config),
    readRows(queries.lastUrl, config),
    countRows(queries.today, config),
  ]);
  return {
    lastAnyAt: ScrapeTimes.parse(lastAny)[0]?.fetched_at ?? null,
    lastUrlAt: ScrapeTimes.parse(lastUrl)[0]?.fetched_at ?? null,
    fetchedToday,
  };
}

/** The newest robots.txt reply we hold for a host, or null when we hold none */
export async function robotsFor(robotsUrl: string, config: DbConfig): Promise<RobotsCache | null> {
  const query = `raw_fetches?url=eq.${encodeURIComponent(robotsUrl)}&select=status,body,error,fetched_at&order=fetched_at.desc&limit=1`;
  const row = RobotsRows.parse(await readRows(query, config))[0]; // the newest row, from readRows
  return row === undefined
    ? null
    : {
        reply: {
          status: row.status,
          body: row.body ?? '',
          ...(row.error === null ? {} : { error: row.error }),
        },
        fetchedAt: row.fetched_at,
      };
}
