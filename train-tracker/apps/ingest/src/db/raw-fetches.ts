// Features: the raw fetch row, the insert, the reads of a journey

import { z } from 'zod';
import type { RawFetch, SourceId } from '@train-tracker/core/types';
import type { SourceRead } from '@train-tracker/core/fusion/resolve';
import { readAllRows, writeRows } from './rest.js';
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
