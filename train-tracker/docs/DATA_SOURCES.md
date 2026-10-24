# Data sources

Where the data comes from, when we check it, and how we decide when sources disagree.

There is no official public API for live Indian train positions. Indian Railways tracks locomotives by GPS and feeds NTES, but does not publish an API. Every source below sits on top of NTES in some way.

Everything here is free. Nothing may need a card. Last checked: 21 Oct 2026. Recheck quotas before each milestone.

## Live sources

| ID | Source | Auth | Env var | Free quota | Use it for | Risk |
|----|--------|------|---------|-----------|------------|------|
| `railradar` | RailRadar API, `https://api.railradar.in/v1` | `Authorization: Bearer <key>` or `X-API-Key` | `RAILRADAR_API_KEY` | 100 requests/month (sandbox, no card) | The only keyed source. Per-train live status and the snapshot. | Snapshot endpoint is marked legacy. |
| `railyatri_scrape` | RailYatri live status page, `https://www.railyatri.in/live-train-status/<slug>` | None | None | Self-imposed: 1 request per minute total | Free second opinion on every check. Last-resort fallback. | HTML can change any day. Scraping may breach their terms. Personal demo use only. |

RailRadar endpoints we use:

- `GET /v1/trains/{number}/live`: one train's running status.
- `GET /v1/legacy/trains/live-map`: every running train in one call. Used by the demo picker.
- `GET /v1/trains/{number}`: timetable.
- `GET /v1/trains/{number}/route`: route geometry as GeoJSON.

The docs only show part of the live response. Save a real response as a fixture before writing the parser.

What the first two real responses showed, 22 Oct 2026:

- **Actual times come back for every past stop, not just the latest.** All 8 halts carry their own `actualArrival` and `actualDeparture` in one call, so a missed check costs nothing. The route holds 222 entries and `isHalt` flags the 8 commercial halts.
- **`provenance` says whether a time is real.** `observed` on a stop the train has passed, `predicted` on one it has not, and absent on the 214 non-halt entries. Only `observed` may become an event. A completed journey reads `observed` throughout and a journey that has not started reads `predicted` throughout, so both states need a fixture.
- **Per-stop `distance` is in the payload**, to one decimal, which is where `timetable_stops.km` now comes from.
- **The live endpoint takes no journey date.** `GET /v1/trains/{number}/live` returns the current or most recent run and names it in `startDate`. There is no way to ask for a specific past date.
- **Station codes do not always match the reference data.** RailRadar calls Mumbai Central `MMCT`; datameet and our `stations` table call it `BCT`. Each adapter maps its own source's codes to ours.

### Getting keys

Someone has to sign up by hand. AI can't do it for you.

1. RailRadar: sign up at railradar.in, then create a key at `https://railradar.in/developers`. Activation needs an Indian +91 mobile number for an OTP.
2. Put the key in `.env` (never committed). See `.env.example`.
3. Email RailRadar: portfolio project, ask for a higher free quota. Costs nothing to ask.

### Dropped sources

**RapidAPI IRCTC1**, dropped 22 Oct 2026. It was meant to be the failover key and the third opinion on scored trips. Two things killed it. The free Basic plan is 10 requests a month, not the 20 we had assumed, which is less than the 25 one scored 12951 trip costs, so it could never have scored a trip. And its pricing FAQ has an entry titled "Why Do You Require A Credit Card For A Freemium API?", so a card may be required even at $0, which hard rule 1 forbids.

That leaves one keyed source and one scrape. The consequences are written into the sections below: there is nothing to fail over to, and the best confidence a single-source confirmation can reach is `medium`.

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

1. Call RailRadar. It is the only keyed source, so a failure here cannot be covered by another key.
2. Also scrape RailYatri once, if enabled. Free, and it gives us a second opinion to merge.

### Quota guard

Free tiers are tiny, so spending is controlled in code.

- Each source has `monthlyBudget` and `demoReserve` in config.
- Development spends from `monthlyBudget - demoReserve`, paced evenly: allowed so far = `(monthlyBudget - demoReserve) * dayOfMonth / daysInMonth`.
- Over the allowance: skip that source and log `quota_paced`.
- Running with `--demo` spends from `demoReserve` instead, with no pacing.
- Preflight prints what is left in each pot.

### Monthly budget on free tiers

| Use | RailRadar (100) | Scrape |
|-----|-----------------|--------|
| Development and testing | 20 | Free |
| One scored trip (12951, 7 stops) | 25 | Free |
| Demo reserve | 55 | Free |

One demo costs about 6 RailRadar calls: preflight 1, picker 1, catch-up 1, about 3 window checks. That is about 9 demos a month.

## Errors and backoff

- On error, wait longer before retrying that source, up to 30 min.
- After 5 failures in a row, open the circuit for 1 hour. No calls to that source until then.
- HTTP 429 opens the circuit straight away.
- Parse errors count as failures. A source returning junk is down.

## Failover during a demo

1. The failing source's circuit opens.
2. There is no second key to fall back to. The next check runs on the scrape alone, and confidence falls to `low`, because only a source of trust 0.5 is reporting out of the 1.3 we asked.
3. If every source is down, nothing new is confirmed. The dot keeps moving on pace, the zone keeps widening, and the app shows how long since the last update.

## Adapter contract

Every source is one adapter. Fetching and parsing are separate, so the raw response is saved before anything can fail.

`SourceId` and `RawFetch` live in `packages/core/src/types.ts`, not with the adapters, because core is not allowed to import from an app.

```ts
// packages/core/src/types.ts

export type SourceId = 'railradar' | 'railyatri_scrape';

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

`SourceAdapter` is the shape to converge on once there is more than one adapter to hold to it. Today RailRadar is a plain exported function, `fetchRailRadarLive(trainNumber, apiKey)`, with no `journeyDate` because the endpoint does not take one, and no `costPerCall` because nothing reads it until the quota guard exists.

Parsers live in `packages/core`, are pure, and are tested against saved real responses in `fixtures/<source>/`. Fixtures exist only so tests don't burn real quota. The app never loads them.

```ts
// packages/core/src/sources/railradar.ts (one file per source: schema and parser)

/** Events from one RailRadar live response, with every problem found */
export function parseRailRadarLive(raw: RawFetch, rawFetchId: string): ParseResult;

/** Canonical station code for a RailRadar one */
export function canonicalStationCode(code: string): string;

export type ParseResult = {
  events: SourceEvent[];
  errors: string[];      // what we could not read, kept for debugging
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
| The event is at an earlier station than one already confirmed with high confidence, **and is timed after that confirmation**. | `backwards` |
| The event implies the train ran faster than its top speed since the last confirmed event. | `too_fast` |
| The response failed its zod schema. | `bad_format` |

The `backwards` rule needs the timing clause because RailRadar returns all 222 route entries on every call, so every check re-reports every past halt. Without it, once NDLS is confirmed, a re-reported arrival at BVI counts as behind and almost nothing survives. Being at an earlier station is only impossible when the report is also *later* than a confirmation further down the route. This agrees with Step 6: a source reporting an earlier station is behind, not wrong.

`too_fast` measures from the latest confirmed event at any confidence, not only high. `bad_format` covers an event whose own `at` or `fetchedAt` is not a usable UTC instant, which also catches a parser that emitted a naive timestamp; a response that fails its schema never becomes an event at all, so the parser reports that one.

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

Rolling window of the last 20 scored trips. Until a source has 5, use the prior: `railradar` 0.8, `railyatri_scrape` 0.5.

Known weak spots:

- All sources probably copy NTES. Agreement may be one source copied twice, not two independent confirmations.
- The truth is our own majority. A source that is alone but right gets marked down.

## Scraping rules

- At most 1 request per minute across all scraped sites.
- Honest `User-Agent` naming the project.
- Respect `robots.txt`.
- Never re-fetch the same page inside 5 min.
- If a site blocks us, stop. Do not rotate IPs or spoof browsers.
