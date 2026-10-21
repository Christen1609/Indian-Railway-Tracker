# Interview notes: train-tracker

How to talk about this project: the pitch, the answers, and the weak spots to own.
Notes to myself, not documentation. They change as the project does.

## 30-second pitch

- My dad asked me to build this. It's a passion project, not a business.
- India has public APIs for live train status, from third parties.
- But I couldn't find a web app that shows the train moving live on a map, the way Rapido shows your ride.
- So I built one.
- The APIs are free, unreliable, and they disagree, so the app merges them.
- It predicts arrival at each station as a time window, from how fast the train actually ran on its last sections.
- It only calls the APIs when an arrival is due, so the free tiers last.
- After every trip it scores its own accuracy.

## Say this before they ask

- "Google's Where is My Train already shows live train status."
- "I'm not competing with it. I built this for the engineering problems."
- Never say "nothing like this exists". Someone in the room has that app.

## How to show merging without a panel

- The app hides sources on purpose. Normal users don't care.
- To prove the merging works, open Supabase in the browser.
- Open the `merge_audit` view. Filter by the train and date.
- Each station shows every source's reported time, side by side.
- `is_chosen` marks the source we kept.
- `confidence_score` shows how sure we are, 0 to 1, with the level next to it.
- Rejected reports show their reason in `rejected`. Point at one.
- Show it on a live trip, or one that ended in the last 24 h. Older data is deleted.

## How the position works

- The feeds only report stations: "arrived Surat 19:55".
- Between stations, we estimate.
- Pace = actual time ÷ timetabled time, on the last two sections.
- Example: a 3-hour section done in 2:30 is pace 0.83, running fast.
- We assume it keeps running fast. That was my idea.
- But we cap it per section.

## Why the cap

- Timetables have spare time built in: 8 min per 100 km on fast sections. Source: Railway Board circular, Aug 2023.
- A train "running fast" is usually using up that spare time.
- So the cap = timetabled time minus spare time.
- And never faster than the train's top speed. 130 km/h for the Mumbai Rajdhani.
- On 12951, that allows 9% to 17% faster, depending on the section.
- After each trip, the fastest pace we actually saw replaces the formula, if it's faster.

## The window

- Fast end: recent pace, capped.
- Slow end: timetable, plus a buffer of 5 min or 5%, because signals stop trains anywhere.
- Example: left Surat at 20:01, a bit slow. Vadodara window: 21:19 to 21:29.
- Window passes with no arrival: "Running late. Updating soon." The window moves.
- Every later window is built from this one, so they widen down the line. That's honest.

## How we ration API calls

- Free tier: 100 calls a month on the main API.
- Checking every 2 minutes would cost about 465 calls for one Mumbai to Delhi trip.
- Most of those calls return nothing new.
- So we check only when the arrival window opens, then every 5 min until it's confirmed.
- About 25 calls a trip.
- No one watching the train? No calls.
- Opening a train counts as watching, while the tab is visible.
- 1 viewer or 100 on the same train: same calls. One check, and every screen updates at once.
- A reserve is held back for demos, so testing can't eat interview calls.

## How we merge disagreeing APIs

1. Convert every reply to one format: train, station, arrived or departed, time.
2. Throw out nonsense (see below).
3. Group reports of the same event.
4. Times within 2 min count as agreement.
5. Most sources agreeing wins. On a tie, the most trusted source wins.
6. We compute delay ourselves from the timetable. Every API calculates it differently.
7. Each kept time gets a confidence score: the trust of the sources that agree, divided by the trust of every source we asked. A source that stayed silent pulls it down.

## What counts as nonsense

- A station that isn't on the route.
- A report saying the train already arrived or left, timed later than when we received it.
  - Example: at 21:20 an API says "arrived Vadodara 21:30". Impossible.
  - We allow 1 min, because clocks differ slightly.
  - Expected times are different. "Expected at 22:30", even an hour away, is a prediction, not nonsense. We don't use those at all. We make our own windows.
  - Bonus: this also catches our own bugs. If a parser forgets the IST offset, times jump 5.5 h ahead and get rejected.
- A time before the train started.
- Leaving before arriving.
- Jumping back to an earlier station.
- Faster than top speed since the last confirmed station.
- A reply in the wrong format.

## How trust works

- Once a month, one full trip is checked against every source.
- After it ends, compare each source with the final merged answer.
- Did it report every station? How far off were its times? How late did it find out?
- Those three numbers become a trust score.

## Weak spots (say them yourself, it shows judgment)

- All these APIs probably copy the same government system. Two agreeing may be one source copied twice.
- The "truth" is our own majority. A source that's alone but right gets marked down.
- No checks in the middle of long sections. Kota to Delhi is 5 hours. A train stuck halfway looks on pace until the window opens.
- The free tier allows about 9 demos a month.
- The scrape backup is a grey area on terms. It's personal, slow (1 request a minute) and stops if blocked.
- The window weights and buffer are starting guesses until trips are scored.

## How accurate is it?

- Don't quote a number you haven't measured.
- Say the targets and how they're measured:
  - Arrives inside the window at least 85% of the time.
  - Median window 20 min wide or less. Otherwise huge windows would fake the first number.
  - Position within 10 km at the moment a train reaches a station, 80% of the time.
- Once trips are scored, replace this section with real numbers.

## Likely questions

**"Walk me through it."**
Use the 30-second pitch. Then offer: "Want the merging, the prediction, or the rationing first?"

**"Doesn't Google do this?"**
"Yes, Where is My Train does. I built this for the problems underneath: merging unreliable feeds, predicting between stations, and doing it on a free quota."

**"How do you know where the train is?"**
"We only know for sure at stations. Between them, we use the train's recent pace, capped by the timetable's spare time, and show a zone instead of a fake exact dot."

**"What if two APIs disagree?"**
Merging steps 1 to 6. Then the weak spot about a shared upstream.

**"How did you deal with rate limits?"**
The rationing section. Lead with 465 calls versus 25.

**"What if an API dies during this demo?"**
"The next one takes over on the next check. If they all die, the train keeps moving on its pace and the zone grows. You'd see 'updated 8 min ago'."

**"Why is the core code pure?"**
"The same estimator runs on the server and in the browser. No clock or network inside it, so I can test it with a fixed time and plain data."

**"What would you do with more time or money?"**
- A paid tier, for checks in the middle of long sections.
- Model where the timetable's spare time sits, so late trains catching up is predicted, not just allowed.
- Snap the train to real track from OpenStreetMap.

**"Is scraping legal?"**
"It's a backup, for a personal project. One request a minute, honest user agent, respects robots.txt, and it stops if blocked. I wouldn't ship it in a product."

**"Hardest bug?"**
Fill this in once you hit one. Likely candidate: journey dates and time zones on overnight trains.

## Numbers to remember

| What | Number |
|------|--------|
| 12951 route | Mumbai Central to New Delhi, 1,384 km, 15 h 32 min, 7 sections |
| Top speed | 130 km/h (160 km/h upgrade not approved yet) |
| Spare time | 8 min per 100 km |
| Caps on 12951 | 9% to 17% faster |
| Free calls | 100 a month on RailRadar |
| Timer polling | about 465 calls a trip |
| Window polling | about 25 calls a trip |
| Demos per month | about 9 |
| Data kept | 24 h after a trip, then only scores and caps |
