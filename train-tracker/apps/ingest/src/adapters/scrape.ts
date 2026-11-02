// Features: the shared fetch of one scraped page, never throwing

import type { RawFetch, SourceId } from '@train-tracker/core/types';

const TIMEOUT_MS = 30_000;

export const USER_AGENT =
  'train-tracker portfolio project (https://github.com/Christen1609/Indian-Railway-Tracker)';

/** Fetches one page for a source, with an honest User-Agent and a 30 second limit, never throwing */
export async function fetchPage(source: SourceId, url: string): Promise<RawFetch> {
  const startedAt = Date.now();
  const base = { source, url } as const;

  try {
    const response = await fetch(url, {
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
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
