// Features: the service role headers, reading rows, writing rows

import { assert } from '@train-tracker/core/types';

const MERGE_DUPLICATES = 'resolution=merge-duplicates';
const REPRESENTATION = 'return=representation';

export type DbConfig = { url: string; serviceRoleKey: string };

/** Headers that authorize the worker as the service role */
function serviceHeaders(config: DbConfig, prefer?: string): Record<string, string> {
  const base: Record<string, string> = {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    'Content-Type': 'application/json',
  };
  return prefer === undefined ? base : { ...base, Prefer: prefer };
}

/** Rows a query returns, failing with the status and what to check */
export async function readRows(path: string, config: DbConfig): Promise<unknown> {
  // the service role headers, from serviceHeaders
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    headers: serviceHeaders(config),
  });
  if (!response.ok) {
    throw new Error(
      `Read of ${path} failed. Status ${response.status}. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.`,
    );
  }
  return response.json();
}

/** How many rows a query matches, without fetching any of them */
export async function countRows(path: string, config: DbConfig): Promise<number> {
  // the service role headers, from serviceHeaders
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    method: 'HEAD',
    headers: serviceHeaders(config, 'count=exact'),
  });
  if (!response.ok) {
    throw new Error(
      `Count of ${path} failed. Status ${response.status}. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.`,
    );
  }
  const range = response.headers.get('content-range');
  const total = range?.split('/')[1];
  assert(
    total !== undefined && total !== '*',
    `a row count in the content-range header, got ${range}`,
  );
  return Number(total);
}

/** Writes rows, merging onto the given conflict target when one is named */
export async function writeRows(
  path: string,
  rows: unknown,
  config: DbConfig,
  onConflict?: string,
): Promise<unknown> {
  const joiner = path.includes('?') ? '&' : '?';
  const url =
    onConflict === undefined
      ? `${config.url}/rest/v1/${path}`
      : `${config.url}/rest/v1/${path}${joiner}on_conflict=${onConflict}`;
  const prefer =
    onConflict === undefined ? REPRESENTATION : `${REPRESENTATION},${MERGE_DUPLICATES}`;

  // the service role headers, from serviceHeaders
  const response = await fetch(url, {
    method: 'POST',
    headers: serviceHeaders(config, prefer),
    body: JSON.stringify(rows),
  });
  if (!response.ok) {
    throw new Error(`Write to ${path} failed. Status ${response.status}. ${await response.text()}`);
  }
  return response.json();
}
