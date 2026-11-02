// Features: the robots.txt cache, the robots.txt rules

import { plusMinutes, secondsBetween } from '../time.js';
import type { IsoUtc } from '../types.js';

const ROBOTS_CACHE_MIN = 24 * 60;
const ROBOTS_RETRY_MIN = 60;
const PATH_AND_QUERY = /^https?:\/\/[^/]+(\/[^#]*)?/;
const OK = 200;
const SERVER_ERROR_FROM = 500;
const UNAUTHORIZED = 401;
const FORBIDDEN = 403;
const ROBOTS_AGENT = 'train-tracker';
const ANY_AGENT = '*';
const NOT_YET = 0;

export type RobotsReply = { status: number; body: string; error?: string };

export type RobotsCache = { reply: RobotsReply; fetchedAt: IsoUtc };

type Rule = { isAllow: boolean; pattern: string };

type Group = { agents: string[]; rules: Rule[] };

/** Whether we got no answer from robots.txt: a failed request, a timeout or a server error */
function isUnreachable(reply: RobotsReply): boolean {
  return reply.error !== undefined || reply.status === 0 || reply.status >= SERVER_ERROR_FROM;
}

/** Whether robots.txt must be fetched again: after an hour if it gave no answer, a day if it did */
export function robotsDue(last: RobotsCache | null, now: IsoUtc): boolean {
  if (last === null) {
    return true;
  }
  const keptMin = isUnreachable(last.reply) ? ROBOTS_RETRY_MIN : ROBOTS_CACHE_MIN;
  return secondsBetween(now, plusMinutes(last.fetchedAt, keptMin)) <= NOT_YET;
}

/** The groups of agents and rules in a robots.txt */
function groupsOf(body: string): Group[] {
  const groups: Group[] = [];
  let isRuleSeen = true;
  for (const line of body.split(/\r?\n/)) {
    const text = line.replace(/#.*/, '').trim();
    const colon = text.indexOf(':');
    if (colon < 0) {
      continue;
    }
    const key = text.slice(0, colon).trim().toLowerCase();
    const value = text.slice(colon + 1).trim();
    if (key === 'user-agent') {
      const current = groups[groups.length - 1];
      if (isRuleSeen || current === undefined) {
        groups.push({ agents: [value.toLowerCase()], rules: [] });
      } else {
        current.agents.push(value.toLowerCase());
      }
      isRuleSeen = false;
    } else if (key === 'allow' || key === 'disallow') {
      groups[groups.length - 1]?.rules.push({ isAllow: key === 'allow', pattern: value });
      isRuleSeen = true;
    }
  }
  return groups;
}

/** The rules that apply to us: our own group if there is one, otherwise the group for all */
function rulesFor(groups: readonly Group[]): Rule[] {
  const own = groups.filter((group) =>
    group.agents.some(
      (agent) => agent !== '' && agent !== ANY_AGENT && ROBOTS_AGENT.includes(agent),
    ),
  );
  const chosen = own.length > 0 ? own : groups.filter((group) => group.agents.includes(ANY_AGENT));
  return chosen.flatMap((group) => group.rules);
}

/** Whether a robots.txt pattern matches the start of a path, with * and a closing $ */
function matches(pattern: string, path: string): boolean {
  const body = pattern.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${body}`).test(path);
}

/** Whether robots.txt lets us fetch a page; no reply, a 401, a 403 or a server error says no */
export function robotsAllow(reply: RobotsReply, url: string): boolean {
  if (isUnreachable(reply) || reply.status === UNAUTHORIZED || reply.status === FORBIDDEN) {
    return false;
  }
  if (reply.status !== OK) {
    return true;
  }

  const path = PATH_AND_QUERY.exec(url)?.[1] ?? '/';
  const hits = rulesFor(groupsOf(reply.body)).filter(
    (rule) => rule.pattern !== '' && matches(rule.pattern, path),
  );
  const longest = hits.reduce<Rule | null>(
    (best, rule) =>
      best === null ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.isAllow)
        ? rule
        : best,
    null,
  );
  return longest === null || longest.isAllow;
}
