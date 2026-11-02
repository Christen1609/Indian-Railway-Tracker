// Features: reading a source's health, writing it back, the blocked state

import { HEALTHY } from '@train-tracker/core/schedule/health';
import type { SourceHealth } from '@train-tracker/core/schedule/health';
import { NOT_BLOCKED } from '@train-tracker/core/schedule/scrape-gate';
import type { BlockState } from '@train-tracker/core/schedule/scrape-gate';
import type { IsoUtc, SourceId } from '@train-tracker/core/types';
import { readRows, writeRows } from './rest.js';
import type { DbConfig } from './rest.js';
import { z } from 'zod';

const HealthRows = z.array(
  z.object({
    failures: z.number().int(),
    last_failure_at: z.string().nullable(),
    opened_at: z.string().nullable(),
  }),
);

/** How a source has been behaving, healthy when we have never recorded it */
export async function healthFor(source: SourceId, config: DbConfig): Promise<SourceHealth> {
  const query = `source_health?source=eq.${source}&select=failures,last_failure_at,opened_at`;
  const rows = HealthRows.parse(await readRows(query, config)); // rows, from readRows
  const row = rows[0];
  return row === undefined
    ? HEALTHY
    : {
        failures: row.failures,
        lastFailureAt: row.last_failure_at,
        openedAt: row.opened_at,
      };
}

/** Records how a source behaved on the call we just made */
export async function saveHealth(
  source: SourceId,
  health: SourceHealth,
  at: IsoUtc,
  config: DbConfig,
): Promise<void> {
  await writeRows(
    'source_health?select=source',
    {
      source,
      failures: health.failures,
      last_failure_at: health.lastFailureAt,
      opened_at: health.openedAt,
      updated_at: at,
    },
    config,
    'source',
  );
}

const BlockRows = z.array(
  z.object({ blocked_at: z.string().nullable(), block_count: z.number().int() }),
);

/** The source_health row that records a source's blocked state */
export function blockRow(
  source: SourceId,
  state: BlockState,
  at: IsoUtc,
): { source: SourceId; blocked_at: IsoUtc | null; block_count: number; updated_at: IsoUtc } {
  return { source, blocked_at: state.blockedAt, block_count: state.blockCount, updated_at: at };
}

/** Whether a site has blocked us, not blocked when we have never recorded it */
export async function blockFor(source: SourceId, config: DbConfig): Promise<BlockState> {
  const query = `source_health?source=eq.${source}&select=blocked_at,block_count`;
  const row = BlockRows.parse(await readRows(query, config))[0]; // the row, from readRows
  return row === undefined
    ? NOT_BLOCKED
    : { blockedAt: row.blocked_at, blockCount: row.block_count };
}

/** Records that a site blocked us, or that it has stopped */
export async function saveBlock(
  source: SourceId,
  state: BlockState,
  at: IsoUtc,
  config: DbConfig,
): Promise<void> {
  await writeRows('source_health?select=source', blockRow(source, state, at), config, 'source');
}
