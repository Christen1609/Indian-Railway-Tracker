// Features: the GitHub issues the worker opens, never throwing

import { z } from 'zod';
import type { IssueDraft } from '@train-tracker/core/schedule/issue';
import type { IsoUtc } from '@train-tracker/core/types';
import type { IssuesConfig } from '../config.js';
import { log } from '../log.js';
import { USER_AGENT } from './scrape.js';

const API = 'https://api.github.com';
const TIMEOUT_MS = 15_000;
const MOST_PER_DAY = 5;
const WORKER_LABEL = 'worker';
const PAGE_SIZE = 100;
const CREATED = 201;

const Issues = z.array(z.object({ title: z.string(), created_at: z.string() }));

export type IssueResult = 'opened' | 'duplicate' | 'capped' | 'off' | 'error';

/** Calls the GitHub API as the worker, and returns the parsed JSON */
async function github(path: string, issues: IssuesConfig, body?: unknown): Promise<unknown> {
  const response = await fetch(`${API}/repos/${issues.repository}/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      authorization: `Bearer ${issues.token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': USER_AGENT,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(
      `GitHub returned ${response.status} for ${path}. Check GH_TOKEN has issues: write.`,
    );
  }
  return response.status === CREATED ? undefined : response.json();
}

/** Opens an issue unless one with the title is open or five were opened today, never throwing */
export async function openIssue(
  draft: IssueDraft,
  issues: IssuesConfig | null,
  now: IsoUtc,
): Promise<IssueResult> {
  if (issues === null) {
    return 'off';
  }

  try {
    const dayStart = `${now.slice(0, 10)}T00:00:00Z`;
    const query = `issues?labels=${WORKER_LABEL}&per_page=${PAGE_SIZE}`;
    const open = Issues.parse(await github(`${query}&state=open`, issues)); // the open worker issues, from github
    if (open.some((one) => one.title === draft.title)) {
      return 'duplicate';
    }
    const today = Issues.parse(await github(`${query}&state=all&since=${dayStart}`, issues)); // today's worker issues, from github
    if (today.filter((one) => one.created_at >= dayStart).length >= MOST_PER_DAY) {
      log('warn', 'issue_capped', { title: draft.title });
      return 'capped';
    }
    await github('issues', issues, draft);
    log('info', 'issue_opened', { title: draft.title });
    return 'opened';
  } catch (cause) {
    log('warn', 'issue_failed', {
      title: draft.title,
      error: cause instanceof Error ? cause.message : String(cause),
    });
    return 'error';
  }
}
