# Data sources

Where the data comes from, when we check it, and how we decide when sources disagree.

There is no official public API for live Indian train positions. Indian Railways tracks locomotives by GPS and feeds NTES, but does not publish an API. Every source below sits on top of NTES in some way.

Everything here is free. Nothing may need a card. Last checked: 30 Oct 2026. Recheck quotas before each milestone.

Page scrapes carry every check. Goibibo and ConfirmTkt are the main scrapes. Travelkhana and RailYatri are backups, and Railmitra is a spare. RailRadar runs on scored trips and as the fallback when the scrapes fail. When RailRadar's budget is spent, the worker keeps tracking on the scrapes. Decided 30 Oct 2026, widened the same day after a research pass over more sites.

## Live sources

| ID | Source | Auth | Env var | Free quota | Use it for | Risk |
|----|--------|------|---------|-----------|------------|------|
| `railradar` | RailRadar API, `https://api.railradar.in/v1` | `Authorization: Bearer <key>` or `X-API-Key` | `RAILRADAR_API_KEY` | 100 requests/month (sandbox, no card) | Scored trips and fallback. Per-train live status and the snapshot. About 6 calls a trip, about 20 a month held in reserve. | Snapshot endpoint is marked legacy. |
| `goibibo_scrape` | Goibibo live status page, `https://www.goibibo.com/trains/live-train-status/<number>-running-status/` | None | None | Self-imposed: 1 request per minute across all scrape sites | Main source. Every check. | HTML can change any day. Ignores a date, but follows a running train past midnight by itself. Its response looked cached. |
| `confirmtkt_scrape` | ConfirmTkt running status page, `https://www.confirmtkt.com/train-running-status/<number>?Date=DD-Mon-YYYY` | None | None | Same shared limit | Main source. Every check. The only source that names the run, through the date parameter. | HTML can change any day. Actual times are in the rendered rows. Not built yet. |
| `travelkhana_scrape` | Travelkhana track-train page, `https://www.travelkhana.com/travelkhana/track-train/<number>-…` | None | None | Same shared limit | Backup. | HTML can change any day. One page holds the last 8 runs. Not built yet. |
| `railyatri_scrape` | RailYatri live status page, `https://www.railyatri.in/live-train-status/<number>` | None | None | Same shared limit | Backup. Its own family, since it says it blends phone GPS. | Shows only the current run, so it cannot cover a train after midnight. |
| `railmitra_scrape` | Railmitra running status page, `…/live-train-running-status/<slug>-<number>?day=yesterday` | None | None | Same shared limit | Spare. Halts only. | Not built yet. |

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
- **Station codes do not always match the reference data.** RailRadar calls Mumbai Central `MMCT`; datameet and our `stations` table call it `BCT`. See Station codes below.
- **The docs list a `date=YYYY-MM-DD` parameter on `/live`.** That contradicts the point above that it takes no date. To verify with one call. Until then, treat it as unproven.

### What the scrapes showed

Live tests on 29 and 30 Oct 2026. The research pass on 30 Oct ran at about 05:00 IST, while the 29 Oct run of 12951 was between Kota and Delhi. Pages saved as fixtures.

- **Goibibo** is rendered on the server. The data is in `__NEXT_DATA__`, under `liveStatusApiResponse`. Each halt has `actualArrivalTime`, `actualArrivalDate` and `arrived` and `departed` flags. It ignores `?date=`, but it followed the running 29 Oct run past midnight by itself. Two fetches 6.5 minutes apart were identical, so the response looks cached.
- **ConfirmTkt** is rendered on the server. Its inline `var data` block is the schedule only. Actual times are in the rendered rows: passed halts have a green tick and an actual time, and upcoming halts show an expected time. It has a date selector from 3 days back to tomorrow. With `?Date=29-Oct-2026` at 04:33 IST it showed the 29 Oct run live. That closes the midnight gap. It is the only source that names the run.
- **Travelkhana** is one HTML page holding the last 8 runs by start date. Each halt shows actual and scheduled times. It also names the last station passed, with a time.
- **RailYatri** is rendered on the server. The data is under `__NEXT_DATA__` then `ltsData`, with passed stops (`previous_stations`) and upcoming stops (`upcoming_stations`) in separate arrays. It ignores a date. At 04:33 IST on 30 Oct it showed the 30 Oct run, not started, and the running 29 Oct run was missing. It says it blends phone GPS. Its delay label disagreed with its own times, which is why we compute our own delay.
- **Railmitra** takes `?day=yesterday`. It lists halts only.
- **All of them lag by about 7 minutes.** ConfirmTkt's `Last Updated` was about 10 minutes old.
- **ConfirmTkt, Goibibo, Travelkhana and Railmitra gave identical times.** They are copies of NTES, so they count as one family. See Step 5.
- ixigo's robots.txt disallows everything. runningstatus.in returns 403.

### Getting keys

Someone has to sign up by hand. AI can't do it for you.

1. RailRadar: sign up at railradar.in, then create a key at `https://railradar.in/developers`. Activation needs an Indian +91 mobile number for an OTP.
2. Put the key in `.env` (never committed). See `.env.example`.
3. Email RailRadar: portfolio project, ask for a higher free quota. Costs nothing to ask.

### Dropped sources

**RapidAPI IRCTC1**, dropped 22 Oct 2026. It was meant to be the failover key and the third opinion on scored trips. Two things killed it. The free Basic plan is 10 requests a month, not the 20 we had assumed, which is less than the 25 one scored 12951 trip costs, so it could never have scored a trip. And its pricing FAQ has an entry titled "Why Do You Require A Credit Card For A Freemium API?", so a card may be required even at $0, which hard rule 1 forbids.

That left one keyed source and one scrape. The scrapes added on 30 Oct 2026 are mostly copies of one upstream, so two of them agreeing is not enough for `high`. See Step 5.

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
| Python scrapers | A second toolchain and test runner. The data is JSON in the page, so `JSON.parse` and zod are enough. |
| An LLM at runtime | Paid or capped, not repeatable, and it can invent a believable wrong "actual" time. LLMs are used at dev time only, to repair parsers. |
| etrain.info live pages and boards (ajax) | Behind a captcha. |
| NTES `/mntes/` | Unreachable. |
| MakeMyTrip | HTTP/2 reset. |
| indiarailinfo boards | 403. |
| trainspnrstatus | 7-day averages only, no live data. |
| railenquiry.in | Empty. |
| ixigo, runningstatus.in | ixigo's robots.txt disallows everything. runningstatus.in returns 403. |
| Station boards | None works over plain HTTP. A per-train page lists every passed stop, so a missed check costs nothing. Revisit only if a plain-HTTP board appears, and use it only at the window station. |

## Run date

Always ask for a specific run date. A page for the wrong run is the worst bug here: the worker would follow a train that has not started and drop the one that is running.

- Every scrape request names the run date where the site allows it (`?Date=DD-Mon-YYYY` on ConfirmTkt). A source that cannot take a date is used only for the run it currently shows. Goibibo ignores a date, so its page is checked against the run date through the dates on its halts.
- Read the date on the page. Discard any page that shows another date, or none, before a journey is created or matched. The adapter reports it as `wrong_run`. It is not a failure and does not count toward the circuit.
- After midnight IST the train is still the journey that left origin before midnight. ConfirmTkt with the old date covers it. Goibibo follows the running train by itself. Travelkhana lists the last 8 runs by start date. RailRadar is asked only if all of those fail, once per remaining window.

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
| Window closed, arrival not reported | Wait 7 min for the feeds to catch up. Then mark late, show "Running late. Updating soon." and push the window. Keep checking at 5, 5, 10, 10, then every 15 min. |
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
- Different trains each cost their own checks. The quota guard caps the total RailRadar calls. Over budget, the scrapes carry on alone.

### What one check does

1. Fetch Goibibo and ConfirmTkt, each for the journey's run date, inside the rate limits below. When one fails, use the next backup: Travelkhana, then RailYatri. Railmitra is the spare.
2. Parse. Only passed stops become events.
3. Call RailRadar only on a scored trip, or when the scrapes failed or have not reported an arrival that is due.

### Lag and a stalled feed

The scrapes run about 7 minutes behind. An arrival can be real and not yet on the page.

- The window closes. Wait 7 minutes before showing "Running late". Checks continue during the wait.
- Each page has an update time. When it is old, the feed has stalled. That means "no news", not "not arrived". The web app shows a live "searching" line, not "Running late".

### Quota guard

Free tiers are tiny, so spending is controlled in code.

- Each source has `monthlyBudget` and `demoReserve` in config.
- Development spends from `monthlyBudget - demoReserve`, paced evenly: allowed so far = `(monthlyBudget - demoReserve) * dayOfMonth / daysInMonth`.
- Over the allowance: skip that source and log `quota_paced`. For RailRadar this means the worker keeps tracking on the scrapes.
- A scored trip spends at most about 6 RailRadar calls. About 20 a month are the reserve. Only a demo or a fallback when both scrapes fail may spend them.
- Running with `--demo` spends from `demoReserve` instead, with no pacing.
- Preflight prints what is left in each pot.

### Monthly budget on free tiers

| Use | RailRadar (100) | Scrape |
|-----|-----------------|--------|
| Development and testing | 20 | Free |
| One scored trip (12951), capped | about 6 | Free |
| Reserve | about 20 | Free |

The rest covers fallback calls. A demo on the scrapes costs about 2 RailRadar calls: preflight 1, picker 1. A fallback adds more.

The monthly count is read from `raw_fetches`. Retention clears page bodies and keeps the rows, so the count stays right after a sweep.

## Errors and backoff

- On error, wait longer before retrying that source, up to 30 min.
- After 5 failures in a row, open the circuit for 1 hour. No calls to that source until then.
- HTTP 429 opens the circuit straight away.
- Parse errors count as failures. A source returning junk is down.
- An unknown station code counts as a failed read.

### Blocked sources

A 401, 403 or 451, or a captcha page, means the site has blocked us. The source stops and the worker retries on its own after 1 day, then 3, then 7. No human resets it. No IP rotation, no browser spoofing.

### Failed reads repair themselves

No step may need a person to do manual work.

1. A failed read saves the page and opens a GitHub issue.
2. An agent fixes the parser, with a new fixture and a test.
3. The fix merges when the tests pass.
4. The worker pulls the latest passing code when it starts each day.

Meanwhile the other scrape and capped RailRadar keep the journey tracked. Blocks and thin trips open issues the same way.

## Failover during a demo

1. The failing source's circuit opens.
2. The other scrape carries the check. Confidence is `medium` at best, because only one family is reporting. If both scrapes are down, capped RailRadar is asked once per remaining window.
3. If every source is down or the RailRadar budget is spent, nothing new is confirmed. The dot keeps moving on pace, the zone keeps widening, and the app shows how long since the last update.

## Adapter contract

Every source is one adapter. Fetching and parsing are separate, so the raw response is saved before anything can fail.

`SourceId` and `RawFetch` live in `packages/core/src/types.ts`, not with the adapters, because core is not allowed to import from an app.

```ts
// packages/core/src/types.ts

export type SourceId =
  | 'railradar'
  | 'goibibo_scrape'
  | 'confirmtkt_scrape'
  | 'travelkhana_scrape'
  | 'railyatri_scrape'
  | 'railmitra_scrape';

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

Parsers keep only actual times. Only passed stops become events. Expected or predicted times from a source are dropped, however far ahead they are. We compute our own windows, the same way we compute our own delay.

### Storage

- A scrape parser keeps only the train-data part of the page: `liveStatusApiResponse` for Goibibo, `ltsData` for RailYatri, and the status rows for ConfirmTkt, Travelkhana and Railmitra. The rest of the page is not stored.
- A page that failed to read is kept whole, so a parser fix can be tested against it.
- Retention clears a journey's stored bodies and keeps the `raw_fetches` rows.
- Cleanup runs when the worker exits.

## Station codes

Every source uses `MMCT` for Mumbai Central. Our reference data has `BCT`. That is the only halt mismatch found on 12951.

Do not match by distance. Scrape distances are rounded, and they are up to 4.4 km off at halts and 14 km off at non-halts. Do not match by name. Names vary between sources.

The rules:

- One shared alias table in `packages/core`, applied before the off-route check, for every source. It replaces the per-adapter maps.
- A row a source marks as a halt, with a code we do not know, is matched by halt order plus latitude and longitude within 2 km. If nothing matches, the event is rejected as `unknown_halt`. That reason is loud. It is not `off_route`, and it counts as a failed read.
- Later, load the full route (about 230 stations), so passed non-halts become position fixes. An unknown non-halt takes the nearest route station within 1.5 km, otherwise it is `off_route`. Drop `XX-*` cabins.
- Every source's fixture test fails if a halt row does not map to one of our 8 codes.

## Merging: when sources disagree

We never merge positions. We merge events, then estimate position from the merged events. The resolver is a pure function in `packages/core/src/fusion/resolve.ts`. It re-runs over all of a journey's events whenever a check lands, in the same step as pace and windows. "Asked" is worked out per event, from the sources that were checked for it, not from the latest check alone. Otherwise a later scrape-only check would downgrade an earlier `high` event.

### Step 1. Normalize

- Station names and aliases become the canonical code. See Station codes above.
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
| A row the source marks as a halt has a code we cannot map to one of our stops. | `unknown_halt` |

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

Sources belong to families. A family is one upstream.

| Family | Sources | Why |
|--------|---------|-----|
| `ntes_copy` | ConfirmTkt, Goibibo, Travelkhana, Railmitra | They gave identical times on 30 Oct. They are copies of NTES. |
| `railyatri` | RailYatri | It says it blends phone GPS, so it may differ from NTES. |
| `railradar` | RailRadar | Its own feed. |

Two pages from the `ntes_copy` family agreeing are one confirmation seen twice. They read `medium`, not `high`.

Levels: `high` needs a score of 0.75 or more **and** at least two families in the winning cluster. `medium` is a score from 0.5, or 0.75 or more with one family. `low` is below 0.5.

| Example | Score | Level |
|---------|-------|-------|
| Goibibo (0.5) and ConfirmTkt (0.5) agree | 1.0 ÷ 1.0 = 1.00, one family | `medium` |
| Goibibo (0.5) and RailYatri (0.5) agree | 1.0 ÷ 1.0 = 1.00, two families | `high` |
| RailRadar (0.8) and Goibibo (0.5) agree | 1.3 ÷ 1.3 = 1.00, two families | `high` |
| Goibibo reports, ConfirmTkt says nothing | 0.5 ÷ 1.0 = 0.50 | `medium` |
| Only Goibibo reports, RailRadar was also asked | 0.5 ÷ 1.3 = 0.38 | `low` |

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

Rolling window of the last 20 scored trips. Until a source has 5, use the prior: `railradar` 0.8, and 0.5 for each scrape.

Scored trips still ask RailRadar for every arrival. Otherwise the scrapes would be graded against themselves.

Known weak spots:

- All sources probably copy NTES. Agreement may be one source copied twice, not two independent confirmations.
- The truth is our own majority. A source that is alone but right gets marked down.

## Scraping rules

- At most 1 request per minute across all scraped sites. A `robots.txt` fetch counts toward the limit.
- Never re-fetch the same URL inside 5 min.
- Honest `User-Agent` naming the project.
- Respect `robots.txt`. Cache it for 24 hours per host. A 403, a 5xx or a timeout means the path is disallowed.
- If a site blocks us, stop that source and follow Blocked sources above. Do not rotate IPs or spoof browsers. No headless browser.
- The limits live in a pure gate in `packages/core`. Its state is read from `raw_fetches`, so it needs no new table.
- Kill-switches: `SCRAPE_ENABLED`, a per-source enable list, the blocked state and a daily scrape cap.

## Where the worker runs

For now the worker runs on the owner's PC. A scheduled task starts it each evening and keeps the PC awake until the train arrives. A free cloud host comes later, once a probe from that host's IP shows the scrapes are not blocked. Cloud IPs get blocked more often than home ones.
