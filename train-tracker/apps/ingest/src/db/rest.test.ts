import { describe, expect, it } from 'vitest';
import { PAGE_SIZE, readAllRows } from './rest.js';

const CONFIG = { url: 'http://db', serviceRoleKey: 'k' };
const QUERY = 'raw_fetches?journey_id=eq.j1&order=fetched_at.asc,id.asc';

/** A reader that serves a table of this many rows by the limit and offset in the query */
function tableOf(total: number): {
  paths: string[];
  readPage: (path: string) => Promise<unknown>;
} {
  const paths: string[] = [];
  const readPage = (path: string): Promise<unknown> => {
    paths.push(path);
    const limit = Number(/limit=(\d+)/.exec(path)?.[1]);
    const offset = Number(/offset=(\d+)/.exec(path)?.[1]);
    const count = Math.max(0, Math.min(limit, total - offset));
    return Promise.resolve(Array.from({ length: count }, (_, row) => offset + row));
  };
  return { paths, readPage };
}

describe('readAllRows', () => {
  it('reads past the page size and stops on the short page', async () => {
    const table = tableOf(PAGE_SIZE * 2 + 5);
    const rows = await readAllRows(QUERY, CONFIG, table.readPage);
    expect(rows.length).toBe(PAGE_SIZE * 2 + 5);
    expect(rows[PAGE_SIZE]).toBe(PAGE_SIZE);
    expect(table.paths.length).toBe(3);
  });

  it('asks again after an exactly full page, then stops on the empty one', async () => {
    const table = tableOf(PAGE_SIZE);
    const rows = await readAllRows(QUERY, CONFIG, table.readPage);
    expect(rows.length).toBe(PAGE_SIZE);
    expect(table.paths.length).toBe(2);
  });

  it('refuses a query with no order', async () => {
    await expect(
      readAllRows('raw_fetches?journey_id=eq.j1', CONFIG, tableOf(1).readPage),
    ).rejects.toThrow();
  });
});
