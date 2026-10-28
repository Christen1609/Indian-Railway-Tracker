export type Candidate = { number: string; name: string };

/** Candidates whose number or name contains the query, ignoring case */
export function matchTrains(query: string, candidates: Candidate[]): Candidate[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return [];
  }
  return candidates.filter(
    (candidate) =>
      candidate.number.includes(needle) || candidate.name.toLowerCase().includes(needle),
  );
}

/** Which trains are tracked, in words */
export function trackedSummary(candidates: Candidate[]): string {
  const numbers = candidates.map((candidate) => candidate.number);
  if (numbers.length === 0) {
    return 'No trains are tracked yet.';
  }
  return `Only ${numbers.join(', ')} ${numbers.length === 1 ? 'is' : 'are'} tracked so far.`;
}

/** What to say when nothing tracked matches */
export function noMatchMessage(query: string, candidates: Candidate[]): string {
  const summary = trackedSummary(candidates); // which trains are tracked, from trackedSummary
  return candidates.length === 0
    ? summary
    : `No tracked train matches “${query.trim()}”. ${summary}`;
}
