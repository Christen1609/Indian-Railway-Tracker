// Features: reading a source's health, writing it back

import { HEALTHY } from '@train-tracker/core/schedule/health';
import type { SourceHealth } from '@train-tracker/core/schedule/health';
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
