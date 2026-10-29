# Product

What we are building, what we are not, and in what order.

## One line

Show where an Indian train is right now, and when it will reach each station as a time window, using only free, unofficial live feeds.

## Why it exists

- A portfolio project to build, demo and explain in interviews.
- Not a business. No users to acquire, no revenue, no app store.
- Showing a dot on a map is not new. Google's Where is My Train already does it.
- What makes this worth talking about:
  1. Merging several unreliable feeds that disagree.
  2. Predicting arrival from how fast the train actually ran on its last sections.
  3. Checking the feeds only when something is due, so free quotas last.
  4. Scoring our own accuracy after every trip.

## Hard constraints

- **Zero spend.** No paid tiers, no card on file, no service that could ever bill us.
- **Live data only.** No recording or replaying journeys, even in demos.
- **Ration API calls.** Check the feeds only inside an arrival window. Never on a timer.

## Non-goals

We will not build these. Say no in PR review.

- Ticket booking, PNR status, seat availability, fares.
- User accounts, logins, notifications.
- Native mobile apps.
- Source names or raw feed details in the web app. Users see a confidence line instead.
- Recording or replaying journeys.
- Our own hardware or crowd-sourced GPS.

## Success criteria

| # | Criterion | How we check |
|---|-----------|--------------|
| S1 | A live demo survives one source failing. | Revoke one source's key mid-demo. The train keeps updating. |
| S2 | Trains arrive inside our window at least 85% of the time. | Journey scores (F5.2). |
| S3 | The median window is 20 min wide or less. Without this, S2 is easy to fake with huge windows. | Journey scores (F5.2). |
| S4 | When a train reaches a station, our position estimate at that moment was within 10 km at least 80% of the time. | Journey scores (F5.2). |
| S5 | Monthly API use stays inside every free tier. | Preflight and ops page. |
| S6 | A new dev runs it locally with one command after cloning. | Fresh clone test. |
| S7 | Either of us can explain merging and pace windows in two minutes each. | Say it out loud. |

Live feeds only report station events, so we never know the true position between stations. S4 is checked at stations for that reason. All targets are starting guesses. Adjust them once real trips are scored, and write down why.

## Features

Priority: **P0** must ship, **P1** should ship, **P2** only if time allows.

### F1 Ingestion (P0)

Fetch live data and store it untouched until the trip is scored.

| ID | Subfeature | Pri | Notes |
|----|-----------|-----|-------|
| F1.1 | Source adapters | P0 | One adapter per source, same interface. See DATA_SOURCES.md. |
| F1.2 | Window scheduler | P0 | Checks a journey only when its next arrival window is open, or it is running late. Never on a timer. |
| F1.3 | Watcher gating | P0 | Only journeys open in a visible tab get checked. Any number of viewers on one train costs the same as one. Exception: the monthly scored trip. |
| F1.4 | Catch-up check | P0 | One check when the first viewer opens a journey, to learn where it is. Skipped if the state is already fresh. |
| F1.5 | Quota guard | P0 | Holds a demo reserve. Spreads the rest evenly over the month. |
| F1.6 | Raw store | P0 | Every response saved before parsing. Scrapes keep only the train-data block, and full pages only for failed reads. Bodies are cleared with the journey's data (F5.5). |
| F1.7 | Backoff and circuit breaker | P0 | Slow down on errors, pause a source after repeated failures. A blocked source retries by itself after 1, 3, then 7 days. |
| F1.8 | Source health | P1 | Success rate, last success, quota left, per source. Ops page only. |

### F2 Merging (P0)

Turn several disagreeing reports into one set of station events we trust. Internal only. Never shown in the app. Viewable in Supabase for interviews (F2.6).

| ID | Subfeature | Pri | Notes |
|----|-----------|-----|-------|
| F2.1 | Normalizer | P0 | Station codes, time zones, journey date. |
| F2.2 | Nonsense filter | P0 | Rejects impossible events and logs why. |
| F2.3 | Resolver | P0 | Groups, dedupes and picks one time per event. |
| F2.4 | Second opinion | P0 | Each check fetches two free scrapes (RailYatri and ConfirmTkt), so there is something to merge. RailRadar joins on scored trips and as fallback. |
| F2.5 | Trust scoring | P1 | Scores each source after every scored trip. |
| F2.6 | Merge audit view | P0 | One database view: for every station event, every source's reported time, the source we chose, and the confidence score. Viewed in Supabase during interviews. Never in the web app. |

### F3 Pace and windows (P0)

Predict arrival from how the train is actually running.

| ID | Subfeature | Pri | Notes |
|----|-----------|-----|-------|
| F3.1 | Pace | P0 | Actual time over timetabled time on the last two sections. Below 1 means running fast. |
| F3.2 | Section caps | P0 | The fastest pace we allow on each section, from timetable spare time and top speed. |
| F3.3 | Learned caps | P1 | After each trip, keep the fastest pace seen per section. It replaces the formula when faster. |
| F3.4 | Arrival window | P0 | Fast end from recent pace, slow end from timetable plus a late buffer. |
| F3.5 | Late handling | P0 | Window passed with no arrival: mark late, push the window, show "Running late. Updating soon." |
| F3.6 | Position and shaded zone | P0 | Dot at best-guess pace. Zone spans the fast and slow assumptions. Never past an unconfirmed station. |
| F3.7 | Downstream windows | P0 | Windows for every later stop. They widen further down the line. |
| F3.8 | Track snapping | P1 | Draw the train on real OSM track instead of straight lines. |

All of F3 runs in the same step as each API reply. The screen gets data, pace and windows in one update.

### F4 Reference data (P0)

| ID | Subfeature | Pri | Notes |
|----|-----------|-----|-------|
| F4.1 | Stations | P0 | Code, name, Hindi name, coordinates. |
| F4.2 | Timetables | P0 | Stops, times, day offset, km from origin. |
| F4.3 | Train top speed | P0 | Per train. 130 km/h for 12951 until the 160 km/h upgrade is approved. |
| F4.4 | Route geometry | P1 | Polyline per train from OSM. |
| F4.5 | Refresh script | P1 | Rebuilds reference data from sources, idempotent. |

### F5 Demo readiness and scoring (P0)

| ID | Subfeature | Pri | Notes |
|----|-----------|-----|-------|
| F5.1 | Estimate log | P0 | Every estimate and window made during a journey, kept only until it is scored. |
| F5.2 | Journey scores | P0 | When a journey ends: did arrivals land in the window, how wide were windows, how far off was the position. Feeds S2 to S4. |
| F5.3 | Preflight | P0 | One command before an interview. Keys work, calls left, APIs answering and how fast, trains running now. Green or red. About 3 calls. |
| F5.4 | Demo picker | P0 | Picks a train that is moving now, has fresh data, and is due at a station in 10 to 20 min. 1 call. |
| F5.5 | Retention | P0 | Deletes a journey's data 24 h after it ends and clears stored page bodies. Fetch rows, scores and learned caps stay. |
| F5.6 | Failover | P0 | A source fails mid-demo, the next one takes over. All fail, the estimate keeps going and the zone widens. |

### F6 Backend API (P0)

| ID | Subfeature | Pri | Notes |
|----|-----------|-----|-------|
| F6.1 | Current state | P0 | Position, zone, status, delay, next stop window. |
| F6.2 | Journey detail | P0 | Timetable, confirmed times and windows for every stop. No source names. |
| F6.3 | Live updates | P0 | Supabase Realtime on `train_state`. |
| F6.4 | Search | P0 | Train by number or name. |
| F6.5 | Watcher presence | P0 | The app reports which journeys are open, for F1.3. |

### F7 Web app (P0, design in M4)

Visual design waits for the frontend skill research. Build function first with plain styling.

| ID | Subfeature | Pri | Notes |
|----|-----------|-----|-------|
| F7.1 | Train search | P0 | Number or name, with journey date. |
| F7.2 | Live map | P0 | MapLibre with OpenFreeMap tiles and Mapterhorn terrain. Route, stations, train, shaded zone. |
| F7.3 | Stop list | P0 | Scheduled time, confirmed time, or window. Delay per stop. |
| F7.4 | Status line | P0 | "On time", "Running 12 min late", "Running late. Updating soon." |
| F7.5 | Confidence line | P1 | "Trains arrive inside this window 9 times out of 10." From journey scores. Hidden until 5 trips are scored. |
| F7.6 | Last update | P0 | "Updated 4 min ago". |
| F7.7 | Demo picker button | P0 | Front end for F5.4. |
| F7.8 | 3D train | P1 | A box train drawn as a MapLibre `fill-extrusion` layer, shown from zoom 10.5. Faces the direction of travel. |
| F7.9 | Time-distance chart | P2 | From the prototype. |
| F7.10 | Share link | P2 | URL for one train and date. |

### F8 All-India map (P2)

Every running train on one map from the RailRadar snapshot. One call covers the country, but it still spends quota.

### F9 Ops page (P1)

For us, not users. Source health, quota and demo reserve left, last errors, recent journey scores.

## Milestones

| M | Goal | Includes | Done when |
|---|------|----------|-----------|
| M0 | Foundation | Repo, docs, tooling, F4.1 to F4.3 | Stations and the 12951 timetable load into Postgres. |
| M1 | One source end to end | F1.1 (RailRadar), F1.2, F1.4, F1.6, F2.1, F3.1, F3.2, F3.4, F3.6, F6.1, F7.2 basic | One real train moves on a plain map with a window. |
| M2 | Merging and rationing | F1.3, F1.5, F1.7, F2.2 to F2.4, F2.6, F3.5, F3.7, F5.6 | Two sources merge, checks happen only in windows, late trains handled. |
| M3 | Demo ready | F5.1 to F5.5, F7.3, F7.4, F7.6, F7.7 | Preflight passes, the picker finds a running train, trips get scored. |
| M4 | Frontend | F7 in full, design system, F7.8 3D train (F7.8 built) | After frontend research. |
| M5 | Extras | F2.5, F3.3, F3.8, F7.5, F8, F9 | Pick by interview value. |

## Open questions

- Product name. The repo is `train-tracker` until we pick one.
- Default watchlist. Start with 12951 Mumbai Rajdhani. It runs 17:00 to 08:32 IST, which is 22:00 to 13:32 in Adelaide during daylight saving. Afternoon interviews rely on the demo picker.
- The scrapes (F2.4) now carry every check. If one site blocks us, the other and capped RailRadar keep the journey tracked.
