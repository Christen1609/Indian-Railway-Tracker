// Features: trust priors, grouping, clustering, the chosen time, the confidence score

import { minutesBetween } from '../time.js';
import { assert } from '../types.js';
import type {
  Confidence,
  EventType,
  IsoUtc,
  ResolvedEvent,
  SourceEvent,
  SourceId,
} from '../types.js';

const AGREE_WINDOW_MIN = 2;
const HIGH_FROM = 0.75;
const MEDIUM_FROM = 0.5;
const FULL_AGREEMENT = 1;

export type Trust = ReadonlyMap<SourceId, number>;

export const TRUST_PRIOR: Trust = new Map<SourceId, number>([
  ['railradar', 0.8],
  ['railyatri_scrape', 0.5],
]);

export type ResolveInput = {
  journeyId: string;
  events: readonly SourceEvent[];
  asked: readonly SourceId[];
  resolvedAt: IsoUtc;
  trust?: Trust;
};

type Report = { source: SourceId; at: IsoUtc; fetchedAt: IsoUtc };

type Group = { stationCode: string; type: EventType; reports: Report[] };

/** What a source's word is worth, nothing for one we do not rate */
function trustOf(source: SourceId, trust: Trust): number {
  return trust.get(source) ?? 0;
}

/** The confidence level a score earns */
export function confidenceOf(score: number): Confidence {
  if (score >= HIGH_FROM) {
    return 'high';
  }
  return score >= MEDIUM_FROM ? 'medium' : 'low';
}

/** Surviving events gathered by the station and the kind of event they report */
function groupsOf(events: readonly SourceEvent[]): Group[] {
  const held = new Map<string, Group>();
  for (const event of events) {
    if (event.rejected !== undefined) {
      continue;
    }
    const key = `${event.stationCode}|${event.type}`;
    const group = held.get(key);
    const report = { source: event.source, at: event.at, fetchedAt: event.fetchedAt };
    if (group === undefined) {
      held.set(key, { stationCode: event.stationCode, type: event.type, reports: [report] });
      continue;
    }
    group.reports.push(report);
  }
  return [...held.values()];
}

/** Each source's latest word on one event, since a feed re-reports every stop it has passed */
function latestPerSource(reports: readonly Report[]): Report[] {
  const latest = new Map<SourceId, Report>();
  for (const report of reports) {
    const held = latest.get(report.source);
    if (held === undefined || minutesBetween(held.fetchedAt, report.fetchedAt) >= 0) {
      latest.set(report.source, report);
    }
  }
  return [...latest.values()];
}

/** Reports split so that every member of a cluster falls inside the agreement window */
function clustersOf(reports: readonly Report[]): Report[][] {
  const sorted = [...reports].sort((one, other) => minutesBetween(other.at, one.at));
  const built: Report[][] = [];
  for (const report of sorted) {
    const current = built[built.length - 1];
    const first = current?.[0];
    if (
      current !== undefined &&
      first !== undefined &&
      minutesBetween(first.at, report.at) <= AGREE_WINDOW_MIN
    ) {
      current.push(report);
      continue;
    }
    built.push([report]);
  }
  return built;
}

/** The distinct sources behind a cluster */
function sourcesIn(cluster: readonly Report[]): SourceId[] {
  return [...new Set(cluster.map((report) => report.source))];
}

/** The most we trust any source in a cluster */
function topTrust(cluster: readonly Report[], trust: Trust): number {
  return Math.max(...cluster.map((report) => trustOf(report.source, trust)));
}

/** When a cluster was first seen */
function seenAt(cluster: readonly Report[]): IsoUtc {
  return cluster
    .map((report) => report.fetchedAt)
    .reduce((earliest, when) => (minutesBetween(when, earliest) > 0 ? when : earliest));
}

/** The cluster with the most agreement, then the most trust, then the earliest sighting */
function winnerOf(clusters: readonly Report[][], trust: Trust): Report[] {
  const ranked = [...clusters].sort((one, other) => {
    const bySources = sourcesIn(other).length - sourcesIn(one).length;
    if (bySources !== 0) {
      return bySources;
    }
    const byTrust = topTrust(other, trust) - topTrust(one, trust); // most trusted source, from topTrust
    return byTrust === 0 ? minutesBetween(seenAt(other), seenAt(one)) : byTrust;
  });
  const won = ranked[0];
  assert(won !== undefined, 'a cluster for every event that has a report');
  return won;
}

/** The report inside a cluster whose source we trust most */
function chosenIn(cluster: readonly Report[], trust: Trust): Report {
  const ranked = [...cluster].sort(
    (one, other) => trustOf(other.source, trust) - trustOf(one.source, trust),
  );
  const chosen = ranked[0];
  assert(chosen !== undefined, 'a report in every cluster');
  return chosen;
}

/** One event per station and type: the time we keep, who said it, and how sure we are */
export function resolveEvents(input: ResolveInput): ResolvedEvent[] {
  const trust = input.trust ?? TRUST_PRIOR;
  const askedTrust = [...new Set(input.asked)].reduce(
    (total, source) => total + trustOf(source, trust),
    0,
  );
  assert(askedTrust > 0, `at least one asked source we rate, got [${input.asked.join()}]`);

  return groupsOf(input.events).map((group) => {
    // each source's latest word, from latestPerSource
    const reports = latestPerSource(group.reports);
    const won = winnerOf(clustersOf(reports), trust); // the cluster we keep, from winnerOf
    const chosen = chosenIn(won, trust); // whose time we keep, from chosenIn
    const sources = sourcesIn(won); // the sources that agree, from sourcesIn
    const agreed = sources.reduce((total, source) => total + trustOf(source, trust), 0);
    const confidenceScore = Math.min(FULL_AGREEMENT, agreed / askedTrust);

    return {
      journeyId: input.journeyId,
      stationCode: group.stationCode,
      type: group.type,
      at: chosen.at,
      confidenceScore,
      confidence: confidenceOf(confidenceScore), // the level it earns, from confidenceOf
      chosenSource: chosen.source,
      sources,
      resolvedAt: input.resolvedAt,
    };
  });
}
