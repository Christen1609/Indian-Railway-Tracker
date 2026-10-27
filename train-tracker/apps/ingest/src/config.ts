// Features: the environment schema, the config read once at startup

import { z } from 'zod';
import { DEFAULT_CHECK_INTERVALS } from '@train-tracker/core/schedule/next-check';
import type { CheckIntervals } from '@train-tracker/core/schedule/next-check';
import type { DbConfig } from './db/rest.js';

const MINUTE_LIST = /^\d+(,\d+)*$/;
const RAILRADAR_BUDGET = 100;
const RETENTION_HOURS = 24;

const Env = z.object({
  RAILRADAR_API_KEY: z.string().min(1),
  SUPABASE_URL: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  RAILRADAR_MONTHLY_BUDGET: z.coerce.number().int().nonnegative().optional(),
  RETENTION_HOURS: z.coerce.number().int().positive().optional(),
  WINDOW_CHECK_INTERVAL_MIN: z.coerce.number().int().positive().optional(),
  LATE_CHECK_INTERVALS_MIN: z.string().regex(MINUTE_LIST).optional(),
});

export type Quota = { monthlyBudget: number };

export type Config = {
  railRadarApiKey: string;
  db: DbConfig;
  quota: Quota;
  retentionHours: number;
  intervals: CheckIntervals;
};

/** The config for this run, validated once so nothing else reads the environment */
export function readConfig(env: Record<string, string | undefined>): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const named = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Config is not usable. Check ${named} in .env against .env.example.`);
  }

  const { data } = parsed;
  const lateMin = data.LATE_CHECK_INTERVALS_MIN;

  return {
    railRadarApiKey: data.RAILRADAR_API_KEY,
    db: { url: data.SUPABASE_URL, serviceRoleKey: data.SUPABASE_SERVICE_ROLE_KEY },
    quota: { monthlyBudget: data.RAILRADAR_MONTHLY_BUDGET ?? RAILRADAR_BUDGET },
    retentionHours: data.RETENTION_HOURS ?? RETENTION_HOURS,
    intervals: {
      windowMin: data.WINDOW_CHECK_INTERVAL_MIN ?? DEFAULT_CHECK_INTERVALS.windowMin,
      lateMin:
        lateMin === undefined ? DEFAULT_CHECK_INTERVALS.lateMin : lateMin.split(',').map(Number),
      departureDelayMin: DEFAULT_CHECK_INTERVALS.departureDelayMin,
    },
  };
}
