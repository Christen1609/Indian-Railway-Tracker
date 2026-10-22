# Glossary

Use these words, spelled this way, in code, comments and UI. If a new term comes up, add it here first.

## Railway terms

| Term | Meaning | In code |
|------|---------|---------|
| Train | A numbered service, like 12951 Mumbai Rajdhani. Runs on a timetable. | `trainNumber: string` |
| Journey | One run of a train, identified by train number plus journey date. | `Journey`, `journeyId` |
| Journey date | The IST calendar date the train left its origin. A train that left on 17 Oct is still the 17 Oct journey on 18 Oct. Most date bugs come from getting this wrong. | `journeyDate: IsoDate` |
| Station code | Indian Railways short code, like `BRC` for Vadodara Jn. Always uppercase. | `stationCode: string` |
| Stop | A station on a train's timetable where it halts. | `TimetableStop` |
| Section | The track between two consecutive stops. | `sectionIndex` |
| Halt | Timetabled minutes between arrival and departure at a stop. | `haltMin` |
| Day offset | Which day of the journey a timetable time falls on. Origin is day 1. | `day` |
| Km | Distance from origin along the route, from the timetable. One decimal place, as the source gives it. | `km` |
| Top speed | Fastest the train may run, per train. 130 km/h for 12951. | `topSpeedKmh` |
| Spare time | Minutes the timetable adds for track work: 8 per 100 km on fast sections. Officially the engineering time allowance. A train running "fast" is often using this up. | `spareMin` |
| IST | India Standard Time, UTC+05:30. Display only. Store UTC. | |
| NTES | National Train Enquiry System. The official system every unofficial feed ultimately comes from. | |

## Data terms

| Term | Meaning | In code |
|------|---------|---------|
| Source | One live feed: the RailRadar API or the RailYatri scrape. Never named in the web app. | `SourceId` |
| Check | One trip to the sources for one journey: one keyed call plus one scrape. | `runCheck()` |
| Event | One fact from a feed: arrived at, departed or passed a station at a time. | `SourceEvent` |
| Event type | `ARR` arrived, `DEP` departed, `PASS` passed without stopping. | `EventType` |
| Resolved event | The single event we trust after merging. | `ResolvedEvent` |
| Chosen source | The source whose time we kept for a resolved event. | `chosenSource` |
| Confidence score | 0 to 1. Trust of the sources that agree ÷ trust of every source asked. Internal. | `confidenceScore` |
| Merge audit | Database view showing every source's report, the chosen source and the confidence score. Interviews only. | `merge_audit` |
| Nonsense | An event that breaks a rule in DATA_SOURCES.md, Step 2. Logged with a reason, never shown. | `RejectReason` |
| Trust score | How reliable a source has been on scored trips. 0 to 1. Internal. | `trust` |
| Delay | Confirmed time minus timetabled time, in minutes. We compute it. We never copy a source's delay. | `delayMin` |
| Snapshot | One response listing every running train in India. Used by the demo picker. | `Snapshot` |

## Estimation terms

| Term | Meaning | In code |
|------|---------|---------|
| Pace | Actual run time ÷ timetabled run time. Below 1 is fast, above 1 is slow. | `pace` |
| Recent pace | Weighted pace of the last two finished sections. | `p` |
| Section cap | The fastest pace we allow on one section. | `capPace` |
| Learned cap | The fastest pace actually seen on a section across trips. Kept forever. | `fastestPace` |
| Window | The time range the train should reach the next stop in, like 21:19 to 21:29. | `windowStart`, `windowEnd` |
| Late buffer | Minutes added to the slow end of a window: 5, or 5% of the section, whichever is more. | `bufferMin` |
| Late | The window closed and no arrival was reported. Shown as "Running late. Updating soon." | `state: 'late'` |
| Position | Our best guess of where the train is now. | `km` |
| Shaded zone | The stretch of track the train is probably on, between slow-pace and fast-pace positions. | `loKm`, `hiKm` |
| Confidence line | "Trains arrive inside this window 9 times out of 10." From journey scores. | `inWindowPct` |

## Operations terms

| Term | Meaning | In code |
|------|---------|---------|
| Watcher | Someone with a journey open in a visible tab. No watcher, no checks. Many watchers cost the same as one. | `presence` |
| Catch-up check | The one check made when the first watcher opens a journey. | `catchUpCheck()` |
| Next check | When the scheduler will check a journey again. | `nextCheckAt` |
| Demo reserve | Calls held back each month that only `--demo` may spend. | `demoReserve` |
| Preflight | Checks before a demo: keys, calls left, API speed, trains running now. | `preflight` |
| Demo picker | Picks a train moving now and due at a station soon. | `pickDemoTrain()` |
| Scored trip | One full journey a month checked end to end, used to score sources. | `isScored` |
| Truth | The final resolved events once a journey has ended. We only know true position at those events. | `truth` |
| Journey score | How our windows and positions did over one finished journey. Kept after the journey is deleted. | `JourneyScore` |
| Retention | Deleting a journey's data 24 h after it ends. | `purgeJourney()` |
