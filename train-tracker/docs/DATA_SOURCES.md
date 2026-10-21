# Data sources

Where the data comes from, when we check it, and how we decide when sources disagree.

There is no official public API for live Indian train positions. Indian Railways tracks locomotives by GPS and feeds NTES, but does not publish an API. Every source below sits on top of NTES in some way.

Everything here is free. Nothing may need a card. Last checked: 21 Oct 2026. Recheck quotas before each milestone.

## Live sources

| ID | Source | Auth | Env var | Free quota | Use it for | Risk |
|----|--------|------|---------|-----------|------------|------|
| `railradar` | RailRadar API, `https://api.railradar.in/v1` | `Authorization: Bearer <key>` or `X-API-Key` | `RAILRADAR_API_KEY` | 100 requests/month (sandbox, no card) | Primary keyed source. Per-train live status and the snapshot. | Snapshot endpoint is marked legacy. |
| `rapidapi_irctc1` | RapidAPI "IRCTC1", host `irctc1.p.rapidapi.com` | `X-RapidAPI-Key` and `X-RapidAPI-Host` | `RAPIDAPI_KEY` | Very small. One project reports 20 calls/month. Unverified. | Failover and scored trips. | Pick a plan with a hard limit and no overage. If it asks for a card, skip it. |
| `railyatri_scrape` | RailYatri live status page, `https://www.railyatri.in/live-train-status/<slug>` | None | None | Self-imposed: 1 request per minute total | Free second opinion on every check. Last-resort fallback. | HTML can change any day. Scraping may breach their terms. Personal demo use only. |

RailRadar endpoints we use:

- `GET /v1/trains/{number}/live`: one train's running status.
- `GET /v1/legacy/trains/live-map`: every running train in one call. Used by the demo picker.
- `GET /v1/trains/{number}`: timetable.
- `GET /v1/trains/{number}/route`: route geometry as GeoJSON.

The docs only show part of the live response. Save a real response as a fixture before writing the parser. Check one thing on that first response: does it include actual times for past stops, or only the latest one? If past stops are included, a missed check costs nothing.

### Getting keys

Someone has to sign up by hand. AI can't do it for you.

1. RailRadar: sign up at railradar.in, then create a key at `https://railradar.in/developers`.
2. RapidAPI: sign up at rapidapi.com, open the IRCTC1 listing, subscribe to the free plan.
3. Put both keys in `.env` (never committed). See `.env.example`.
4. Email RailRadar: portfolio project, ask for a higher free quota. Costs nothing to ask.

## Static sources

| Source | What | License | Use it for |
|--------|------|---------|------------|
| datameet/railways on GitHub | `stations.json`, `trains.json`, `schedules.json` | CC0 | Seed stations and timetables (F4.1, F4.2). |
| OpenStreetMap, India extract from Geofabrik | `railway=rail` ways, `railway=station` nodes | ODbL, credit OSM | Track geometry (F3.8, F4.4). |
| etrain.info, ixigo train pages | Timetable per train | Read only, by hand | Cross-check a timetable. |
| Railway Board ETA circular, Aug 2023 | Engineering time allowance: 8 min per 100 km on 130 km/h+ sections, 6 below | Public | Section caps (F3.2). |

The datameet data has no visible update date. Treat it as old. Cross-check any timetable we demo.

## Ruled out

| Source | Why |
|--------|-----|
| Any paid tier | Zero spend. |
| Google Maps | Needs a card on file, even for the free tier. |
| eRail.in API | Suspended until further notice. |
| data.gov.in train timetable | Catalog page exists but shows no data. |
| NTES directly | The upstream everyone wraps. The most likely to block us. |
| Google Where is My Train | No public API. |
| Multiple accounts or rotating keys | Breaks provider terms. Keys get banned, maybe mid-demo. |

## When we check

We never check on a timer. We check only when something is due.

### The rule

| Situation | What happens |
|-----------|--------------|
| Nobody has the journey open | No checks. Exception: the monthly scored trip. |
| First viewer opens a journey | One catch-up check to learn where the train is. |
| Before the train's timetabled departure from origin | No checks. |
| From origin departure time | Check 2 min after timetabled departure, then every 5 min until departure is confirmed. |
| Between stations, window not open yet | No checks. The estimate moves the dot. |
| Arrival window opens | First check. |
| Window open, arrival not reported | Check every 5 min until the window closes. |
| Window closed, arrival not reported | Mark late. Show "Running late. Updating soon." Push the window. Keep checking at 5, 5, 10, 10, then every 15 min. |
| Arrival confirmed | Lock the delay, update pace, set the next window. No checks until it opens. |
| Halt at a station | Not checked. Departure is inferred from the halt and confirmed by the next check, if the reply includes it. |
| Final arrival confirmed | Stop. |

Example: the window for Vadodara is 21:19 to 21:29. Checks at 21:19, 21:24, 21:29. Nothing yet, so the train is late. Checks at 21:34, 21:39, 21:49 and so on until arrival shows.

There is no check in the middle of long sections. On Kota to New Delhi that means about 5 hours without a check. If the train stops halfway, we show it on pace until the window opens. Accepted to save calls.

### Who counts as watching

- Opening a train in the app counts as watching, while the tab is visible.
- Hidden tab: stops counting after 5 min.
- Visible but untouched for 60 min: stops counting until someone interacts again.
- Last watcher leaves: checks stop after a 2 min grace period, so a page refresh doesn't trigger a new catch-up check.
- The catch-up check is skipped if the journey was updated within the last check interval.
- Many watchers on one train cost the same as one. The server checks once, and Realtime pushes the update to every screen.
- Different trains each cost their own checks. The quota guard caps the total. Over budget, only the free scrape is used.

### What one check does

1. Call one keyed source, in trust order. If it fails, try the next.
2. Also scrape RailYatri once, if enabled. Free, and it gives us a second opinion to merge.
3. On the monthly scored trip only: once a stop's arrival is confirmed, call RapidAPI once for its version. That gives every source a report to score.

### Quota guard

Free tiers are tiny, so spending is controlled in code.

- Each source has `monthlyBudget` and `demoReserve` in config.
- Development spends from `monthlyBudget - demoReserve`, paced evenly: allowed so far = `(monthlyBudget - demoReserve) * dayOfMonth / daysInMonth`.
- Over the allowance: skip that source and log `quota_paced`.
- Running with `--demo` spends from `demoReserve` instead, with no pacing.
- Preflight prints what is left in each pot.

### Monthly budget on free tiers

| Use | RailRadar (100) | RapidAPI (~20) | Scrape |
|-----|-----------------|----------------|--------|
| Development and testing | 20 | 3 | Free |
| One scored trip (12951, 7 stops) | 25 | 7 | Free |
| Demo reserve | 55 | 10 | Free |

One demo costs about 6 RailRadar calls: preflight 1, picker 1, catch-up 1, about 3 window checks. That is about 9 demos a month.

## Errors and backoff

- On error, wait longer before retrying that source, up to 30 min.
- After 5 failures in a row, open the circuit for 1 hour. No calls to that source until then.
- HTTP 429 opens the circuit straight away.
- Parse errors count as failures. A source returning junk is down.

## Failover during a demo

1. The failing source's circuit opens.
2. The next check uses the next source in trust order.
3. If every source is down, nothing new is confirmed. The dot keeps moving on pace, the zone keeps widening, and the app shows how long since the last update.

## Adapter contract

Every source is one adapter. Fetching and parsing are separate, so the raw response is saved before anything can fail.

```ts
// apps/ingest/src/adapters/types.ts

export type SourceId = 'railradar' | 'rapidapi_irctc1' | 'railyatri_scrape';

export interface SourceAdapter {
  readonly id: SourceId;
  /** Quota units one call costs. 0 for the scrape. */
  readonly costPerCall: number;
  /** Network call only. Never parses. Never throws: errors come back as a result. */
  fetchLive(trainNumber: string, journeyDate: IsoDate): Promise<RawFetch>;
}

export type RawFetch = {
  source: SourceId;
  url: string;
  status: number;        // HTTP status, 0 if the request never completed
  body: string;          // exact response body, saved as is
  fetchedAt: string;     // ISO 8601 UTC
  latencyMs: number;
  error?: string;        // network or timeout error, if any
};
```

Parsers live in `packages/core`, are pure, and are tested against saved real responses in `fixtures/<source>/`. Fixtures exist only so tests don't burn real quota. The app never loads them.

```ts
// packages/core/src/sources/railradar.parse.ts (one file per source)

/** Turns one raw response into source events. Pure. Invalid input returns errors, never throws. */
export function parseRailRadar(raw: RawFetch, ctx: ParseContext): ParseResult;

export type ParseResult = {
  events: SourceEvent[];
  errors: ParseError[];  // fields we could not read, kept for debugging
};

export type SourceEvent = {
  source: SourceId;
  trainNumber: string;   // '12951'
  journeyDate: IsoDate;  // IST date the train left origin
  stationCode: string;   // 'BRC', uppercase, normalized
  type: 'ARR' | 'DEP' | 'PASS';
  at: string;            // when it happened, ISO 8601 UTC
  fetchedAt: string;     // when we saw it, ISO 8601 UTC
  rawFetchId: string;    // link back to the stored response
};
```

Every response is validated with a zod schema inside the parser. If the shape changes, the parser returns errors and the source's health drops. It never silently produces wrong events.

Parsers keep only actual times. Expected or predicted times from a source are dropped, however far ahead they are. We compute our own windows, the same way we compute our own delay.

## Merging: when sources disagree

We never merge positions. We merge events, then estimate position from the merged events. The resolver is a pure function in `packages/core/src/fusion/resolve.ts`. It re-runs over all of a journey's events whenever a check lands, in the same step as pace and windows.

### Step 1. Normalize

- Station names and aliases become the canonical code.
- All times become UTC. Sources often send IST without an offset; the parser attaches `+05:30`.
- Journey date is the IST date of departure from origin, not today's date.

### Step 2. Throw out nonsense

Reject the event and log the reason when any of these is true. Rejected events never reach the screen.

| Rule | Reason code |
|------|-------------|
| Station is not on this train's route. | `off_route` |
| A report says the train already arrived or left, but `at` is more than 1 min after `fetchedAt`. Also catches a parser that forgot the IST offset. | `future_time` |
| `at` is more than 30 min before timetabled origin departure. | `before_start` |
| `DEP` at a station is earlier than `ARR` at the same station. | `dep_before_arr` |
| The event puts the train behind a station already confirmed with high confidence. | `backwards` |
| The event implies the train ran faster than its top speed since the last confirmed event. | `too_fast` |
| The response failed its zod schema. | `bad_format` |

### Step 3. Group

Group surviving events by `(journey, stationCode, type)`.

### Step 4. Pick one time per group

1. Cluster times within `AGREE_WINDOW_MIN = 2` of each other.
2. Pick the cluster with the most distinct sources.
3. On a tie, pick the cluster containing the highest-trust source.
4. On a tie, pick the cluster seen first.
5. The event time is the time from the highest-trust source inside the winning cluster. That source is saved as the chosen source.

### Step 5. Confidence score

A number from 0 to 1 for each resolved event: how much of the trust we asked agrees with the time we kept.

```
confidenceScore = sum of trust of sources in the winning cluster
                ÷ sum of trust of every source asked for this event
```

A source we asked that said nothing counts against the score.

| Example | Score | Level |
|---------|-------|-------|
| RailRadar (0.8) and the scrape (0.5) agree | 1.3 ÷ 1.3 = 1.00 | `high` |
| RailRadar and RapidAPI (0.7) agree, the scrape disagrees | 1.5 ÷ 2.0 = 0.75 | `high` |
| RailRadar reports, the scrape says nothing | 0.8 ÷ 1.3 = 0.62 | `medium` |
| Only the scrape reports, RailRadar was asked | 0.5 ÷ 1.3 = 0.38 | `low` |

Levels: `high` at 0.75 or more, `medium` from 0.5, `low` below 0.5.

Internal only. Viewable in Supabase through the merge audit view (F2.6). The app shows the confidence line from journey scores instead (F7.5).

### Step 6. Progress and delay

- Progress is the furthest confirmed event in route order. A source reporting an earlier station is behind, not wrong.
- Delay = confirmed time minus timetabled time. Every source computes delay differently, so we never copy theirs.

## Trust scoring (F2.5)

Runs after each scored trip, before retention deletes its data. The final merged events are the truth for that trip.

| Metric | Meaning |
|--------|---------|
| `coverage` | Events the source reported / events in truth. |
| `errorMin` | Median absolute difference from the truth. |
| `lagMin` | Median of (first `fetchedAt` that included the event minus `at`). How late the source learns things. |

Starting formula, to be tuned:

```
trust = coverage / (1 + errorMin + lagMin / 10)
```

Rolling window of the last 20 scored trips. Until a source has 5, use the prior: `railradar` 0.8, `rapidapi_irctc1` 0.7, `railyatri_scrape` 0.5.

Known weak spots:

- All sources probably copy NTES. Agreement may be one source copied twice, not two independent confirmations.
- The truth is our own majority. A source that is alone but right gets marked down.

## Scraping rules

- At most 1 request per minute across all scraped sites.
- Honest `User-Agent` naming the project.
- Respect `robots.txt`.
- Never re-fetch the same page inside 5 min.
- If a site blocks us, stop. Do not rotate IPs or spoof browsers.
