// Features: the environment schema, the config read once at startup

import { z } from 'zod';
import { DEFAULT_CHECK_INTERVALS } from '@train-tracker/core/schedule/next-check';
import type { CheckIntervals } from '@train-tracker/core/schedule/next-check';
import { SCRAPE_SOURCES } from '@train-tracker/core/schedule/scrape-gate';
import type { SourceId } from '@train-tracker/core/types';
import type { TrainSlugs } from './adapters/scrape-sites.js';
import type { DbConfig } from './db/rest.js';

const REPOSITORY = /^[\w-][\w.-]*\/[\w-][\w.-]*$/;
const MINUTE_LIST = /^[1-9]\d*(,[1-9]\d*)*$/;
const RAILRADAR_BUDGET = 100;
const RETENTION_HOURS = 24;
const RAILRADAR_DEMO_RESERVE = 20;
const DEFAULT_DAILY_CAP = 300;

const TRAIN_SLUGS: Record<string, TrainSlugs> = {
  '12951': {
    travelkhana: 'Mumbai-Central---New-Delhi-Tejas-Rajdhani-Express',
    railmitra: 'mumbai-rajdhani',
  },
};

/** Whether a word is the id of a scrape source */
function isScrapeSource(word: string): word is SourceId {
  return SCRAPE_SOURCES.some((source) => source === word);
}

const SourceList = z
  .string()
  .transform((list) => list.split(',').map((one) => one.trim()))
  .refine((list): list is SourceId[] => list.every(isScrapeSource), {
    message: 'only scrape source ids, separated by commas',
  });

const Env = z.object({
  RAILRADAR_API_KEY: z.string().min(1),
  SUPABASE_URL: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  RAILRADAR_MONTHLY_BUDGET: z.coerce.number().int().nonnegative().optional(),
  RAILRADAR_DEMO_RESERVE: z.coerce.number().int().nonnegative().optional(),
  RETENTION_HOURS: z.coerce.number().int().positive().optional(),
  WINDOW_CHECK_INTERVAL_MIN: z.coerce.number().int().positive().optional(),
  LATE_CHECK_INTERVALS_MIN: z.string().regex(MINUTE_LIST).optional(),
  SCRAPE_ENABLED: z.enum(['true', 'false']).optional(),
  SCRAPE_SOURCES: SourceList.optional(),
  SCRAPE_DAILY_CAP: z.coerce.number().int().positive().optional(),
  WORKER_MAX_MINUTES: z.coerce.number().int().positive().optional(),
  GH_TOKEN: z.string().min(1).optional(),
  GITHUB_REPOSITORY: z.string().regex(REPOSITORY).optional(),
});

export type Quota = { monthlyBudget: number; demoReserve: number };

export type ScrapeConfig = {
  isEnabled: boolean;
  sources: readonly SourceId[];
  dailyCap: number;
  slugs: Readonly<Record<string, TrainSlugs>>;
};

export type IssuesConfig = { token: string; repository: string };

export type Config = {
  railRadarApiKey: string;
  db: DbConfig;
  quota: Quota;
  retentionHours: number;
  intervals: CheckIntervals;
  scrape: ScrapeConfig;
  workerMaxMin: number | null;
  issues: IssuesConfig | null;
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
    quota: {
      monthlyBudget: data.RAILRADAR_MONTHLY_BUDGET ?? RAILRADAR_BUDGET,
      demoReserve: data.RAILRADAR_DEMO_RESERVE ?? RAILRADAR_DEMO_RESERVE,
    },
    retentionHours: data.RETENTION_HOURS ?? RETENTION_HOURS,
    intervals: {
      windowMin: data.WINDOW_CHECK_INTERVAL_MIN ?? DEFAULT_CHECK_INTERVALS.windowMin,
      lateMin:
        lateMin === undefined ? DEFAULT_CHECK_INTERVALS.lateMin : lateMin.split(',').map(Number),
      departureDelayMin: DEFAULT_CHECK_INTERVALS.departureDelayMin,
    },
    scrape: {
      isEnabled: data.SCRAPE_ENABLED !== 'false',
      sources: data.SCRAPE_SOURCES ?? SCRAPE_SOURCES,
      dailyCap: data.SCRAPE_DAILY_CAP ?? DEFAULT_DAILY_CAP,
      slugs: TRAIN_SLUGS,
    },
    workerMaxMin: data.WORKER_MAX_MINUTES ?? null,
    issues:
      data.GH_TOKEN === undefined || data.GITHUB_REPOSITORY === undefined
        ? null
        : { token: data.GH_TOKEN, repository: data.GITHUB_REPOSITORY },
  };
}
