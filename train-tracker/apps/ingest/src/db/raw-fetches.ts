// Features: the raw fetch row, the insert

import { z } from 'zod';
import type { RawFetch } from '@train-tracker/core/types';

const Inserted = z.array(z.object({ id: z.string().min(1) }));

export type DbConfig = { url: string; serviceRoleKey: string };

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
  const response = await fetch(`${config.url}/rest/v1/raw_fetches?select=id`, {
    method: 'POST',
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  });

  if (!response.ok) {
    throw new Error(
      `Insert into raw_fetches failed. Status ${response.status}. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.`,
    );
  }

  const inserted = Inserted.safeParse(await response.json());
  const first = inserted.success ? inserted.data[0] : undefined;
  if (first === undefined) {
    throw new Error('Insert into raw_fetches returned no id. Check the Prefer header and RLS.');
  }
  return first.id;
}
