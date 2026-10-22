// Features: the RailRadar live fetch

import type { RawFetch } from '@train-tracker/core/types';

const BASE_URL = 'https://api.railradar.in/v1';
const SOURCE = 'railradar';

/** Fetches one train's live status, never throwing */
export async function fetchRailRadarLive(trainNumber: string, apiKey: string): Promise<RawFetch> {
  const url = `${BASE_URL}/trains/${trainNumber}/live`;
  const startedAt = Date.now();
  const base = { source: SOURCE, url } as const;

  try {
    const response = await fetch(url, { headers: { 'x-api-key': apiKey } });
    return {
      ...base,
      status: response.status,
      body: await response.text(),
      fetchedAt: new Date(startedAt).toISOString(),
      latencyMs: Date.now() - startedAt,
    };
  } catch (cause) {
    return {
      ...base,
      status: 0,
      body: '',
      fetchedAt: new Date(startedAt).toISOString(),
      latencyMs: Date.now() - startedAt,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}
