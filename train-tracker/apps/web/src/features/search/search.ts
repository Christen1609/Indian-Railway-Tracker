// Features: search query building, ranking and keyboard stepping

import type { Train } from '@train-tracker/core/types';

export type Candidate = { number: string; name: string };
export type SearchPlan =
  { column: 'number'; pattern: string } | { column: 'name'; pattern: string } | null;

export const SUGGESTION_LIMIT = 8;
export const SEARCH_DEBOUNCE_MS = 200;

/** Candidates for some trains */
export function toCandidates(trains: readonly Train[]): Candidate[] {
  return trains.map((train) => ({ number: train.number, name: train.name }));
}

/** The suggestion one step on, wrapping through -1 for none */
export function nextActiveIndex(activeIndex: number, step: 1 | -1, count: number): number {
  const slots = count + 1;
  return ((activeIndex + 1 + step + slots) % slots) - 1;
}

/** The query text with spaces tidied and pattern characters removed */
export function cleanQuery(query: string): string {
  return query
    .replace(/[%_\*,()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Which column to search and the pattern to match, or null for blank text */
export function planSearch(query: string): SearchPlan {
  const text = cleanQuery(query);
  if (text === '') {
    return null;
  }
  return /^\d+$/.test(text)
    ? { column: 'number', pattern: `${text}%` }
    : { column: 'name', pattern: `%${text}%` };
}

/** How well a train fits the query: 0 is an exact number, then number prefix, name start, other */
function rankOf(text: string, train: Candidate): number {
  const name = train.name.toLowerCase();
  if (train.number === text) {
    return 0;
  }
  if (train.number.startsWith(text)) {
    return 1;
  }
  return name.startsWith(text) ? 2 : 3;
}

/** Candidates best match first, keeping the given order among equals */
export function rankTrains(query: string, candidates: readonly Candidate[]): Candidate[] {
  const text = cleanQuery(query).toLowerCase();
  return candidates
    .map((candidate, index) => ({ candidate, index, rank: rankOf(text, candidate) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.candidate);
}

/** What to say when no train matches */
export function noMatchMessage(query: string): string {
  return `No train matches “${query.trim()}”.`;
}
