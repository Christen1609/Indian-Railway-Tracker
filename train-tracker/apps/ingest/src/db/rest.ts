// Features: the service role headers, reading rows, writing rows

import { assert } from '@train-tracker/core/types';

const MERGE_DUPLICATES = 'resolution=merge-duplicates';
const REPRESENTATION = 'return=representation';
const FILTERED = '=eq.';
export const PAGE_SIZE = 1000;

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

/** Every row a query matches, read page by page until a short page; the query must be ordered */
export async function readAllRows(
  path: string,
  config: DbConfig,
  readPage: typeof readRows = readRows,
): Promise<unknown[]> {
  assert(
    path.includes('order='),
    `an ordered query so pages neither overlap nor skip, got ${path}`,
  );
  const joiner = path.includes('?') ? '&' : '?';
  const rows: unknown[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await readPage(`${path}${joiner}limit=${PAGE_SIZE}&offset=${offset}`, config); // one page, from readRows
    assert(Array.isArray(page), `an array of rows, got ${typeof page}`);
    rows.push(...page);
    if (page.length < PAGE_SIZE) {
      return rows;
    }
  }
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

/** Changes the rows a query matches, which must be filtered */
export async function patchRows(path: string, changes: unknown, config: DbConfig): Promise<void> {
  assert(path.includes(FILTERED), `a filtered patch, got ${path}`);
  // the service role headers, from serviceHeaders
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: serviceHeaders(config),
    body: JSON.stringify(changes),
  });
  if (!response.ok) {
    throw new Error(`Patch of ${path} failed. Status ${response.status}. ${await response.text()}`);
  }
}

/** Deletes the rows a query matches, which must be filtered */
export async function deleteRows(path: string, config: DbConfig): Promise<void> {
  assert(path.includes(FILTERED), `a filtered delete, got ${path}`);
  // the service role headers, from serviceHeaders
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: serviceHeaders(config),
  });
  if (!response.ok) {
    throw new Error(
      `Delete from ${path} failed. Status ${response.status}. ${await response.text()}`,
    );
  }
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
