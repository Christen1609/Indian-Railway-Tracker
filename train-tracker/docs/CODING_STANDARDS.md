# Coding standards

How we write code here. Tools enforce what they can. This file covers the rest.

If a rule here gets in the way, change the rule in a PR. Don't quietly ignore it.

## The rules that matter most

1. `packages/core` is pure. No network, no database, no `Date.now()`, no `Math.random()`. Pass `now` in.
2. Every external response goes through a zod schema before we use it.
3. Units go in names. `delayMin`, `distanceKm`, `latencyMs`. Never a bare `delay`.
4. Store UTC, show IST. Time zone math lives only in `packages/core/src/time.ts`.
5. If you can't explain a line in an interview, it doesn't merge. This applies double to AI-written code.

## Language and tooling

- TypeScript, `strict: true` and `noUncheckedIndexedAccess: true`.
- No `any`. Use `unknown` and narrow it. If `any` is truly needed, add a comment saying why.
- No non-null assertions (`!`) outside tests.
- Prettier formats. ESLint with `typescript-eslint` recommended rules lints. No style debates in review: if the tools accept it, it's fine.
- `pnpm lint`, `pnpm typecheck` and `pnpm test` must pass before a PR is opened.

## Naming

| Thing | Style | Example |
|-------|-------|---------|
| Files and folders | kebab-case, with a dotted role suffix where useful | `quota-guard.ts`, `railradar.parse.ts` |
| Types, interfaces, React components | PascalCase | `ResolvedEvent`, `StopList` |
| Functions and variables | camelCase | `projectArrivals` |
| Constants | UPPER_SNAKE_CASE | `AGREE_WINDOW_MIN` |
| Booleans | `is`, `has`, `should` prefix | `isOverdue` |
| Database columns | snake_case | `journey_date` |

More rules:

- Functions are verbs: `parseRailRadar`, `estimatePosition`. Types are nouns.
- Use the words in `docs/GLOSSARY.md`. Say `journey`, not `trip` or `run`. Say `stationCode`, not `stn` or `code`.
- Units always in the name when a number has a unit: `Min`, `Km`, `Ms`, `Utc` for ISO strings in UTC.
- Station codes and train numbers are `string`, never `number`. Train numbers can have leading zeros, like `01756`.

## Functions and modules

- One job per function. If the name needs "and", split it.
- Prefer plain functions and data over classes. Use a class only when it holds state that has to live across calls, like the scheduler.
- Export only what other modules use.
- No default exports. Named exports keep names the same everywhere.
- Keep files under about 300 lines. Split by concept, not by type.
- No barrel files (`index.ts` that re-exports everything) inside `packages/core`. Import from the file that owns the thing.

## Errors

- Adapters never throw. They return `RawFetch` with an `error` field.
- Parsers never throw on bad input. They return `{ events, errors }`.
- Throw only for programmer mistakes: impossible states, broken invariants. Use `assert()` from `packages/core/src/assert.ts` with a message that says what was expected.
- Never swallow an error. If you catch, either handle it or log it with context and re-throw.
- Error messages say what happened and what to check: `RailRadar returned 401. Check RAILRADAR_API_KEY in .env.`

## Comments

Comments explain **why**. The code already says what.

**Do:**

```ts
// Sources send IST without an offset. Attach +05:30 before parsing or every
// event lands 5.5 hours early.
const atUtc = istToUtc(raw.actual_time);

// Hold short of the next station until the feed confirms arrival.
// Better to look late than to show the train somewhere it hasn't reached.
const frac = Math.min(elapsedMin / runMin, MAX_SECTION_FRACTION);
```

**Don't:**

```ts
// loop over events
for (const e of events) {

// set delay
delayMin = actual - scheduled;
```

Rules:

- Every exported function, type and constant gets a one-line `/** */` doc comment. Add `@param` only when a name isn't enough.
- Every magic number becomes a named constant with a comment saying where it came from or how it was chosen.

  ```ts
  /** Times within this many minutes count as the same report. Chosen from the
   *  rounding seen in RailRadar and RapidAPI fixtures. Revisit after M2. */
  export const AGREE_WINDOW_MIN = 2;
  ```

- Any fact from outside the code gets a source and date: `// Timetable from etrain.info, checked 2026-10-17.`
- TODOs need an owner and an issue: `// TODO(christen): handle PASS events (#14)`. A TODO without an issue gets deleted in review.
- No commented-out code. Git remembers it.
- No comments that narrate history (`// changed this because the old version broke`). That goes in the commit message.

## Data from outside

- Every source response has a zod schema in `packages/core/src/sources/<source>.schema.ts`.
- Parse with `safeParse`. On failure, return the zod issues as parse errors.
- When a source changes shape: save the new response as a fixture first, then update the schema, then the parser. The failing test proves the fix.

## Time

- Use the helpers in `packages/core/src/time.ts`. Don't call `new Date(string)` on source data directly; it guesses the time zone.
- Timetable times are minutes from midnight IST on day 1 of the journey (`1952` = 08:32 on day 2).
- Anything that depends on the current time takes `now` as an argument.

## Tests

Vitest. Tests sit next to the file they test: `resolve.ts` and `resolve.test.ts`.

| Layer | What to test | Target |
|-------|-------------|--------|
| `packages/core` | Everything. Parsers on real fixtures, resolver as a table of cases, estimator invariants. | 90% line coverage |
| `apps/ingest` | Scheduler, quota guard, backoff with a fake clock and fake adapters. | Key paths |
| `apps/web` | Formatting helpers and any logic in hooks. UI by hand for now. | Helpers only |

Rules:

- Parser tests use real saved responses from `fixtures/`, never hand-written JSON. Hand-written JSON tests what we think the API sends. Fixtures are for tests only; the app never loads them.
- Resolver tests are table-driven. One row per scenario, with a name that says what it proves.
- Pace and window tests check invariants as well as values:
  - The train never passes a station without a confirmed `ARR` or `PASS`.
  - `loKm ≤ km ≤ hiKm` always.
  - `windowStart ≤ windowEnd` always.
  - No pace is ever faster than its section cap.
  - Expected departures are never before timetabled departures.
  - Later windows are never narrower than earlier ones.
- Scheduler tests count calls. A full 12951 trip must stay inside the budget in DATA_SOURCES.md. Use a fake clock and fake adapters.
- Accuracy scorer tests use small constructed journeys where the right score is easy to work out by hand.
- A bug fix comes with a test that failed before the fix.

## Git and pull requests

- `main` is always deployable. Nobody pushes to it directly.
- Branches: `feat/short-name`, `fix/short-name`, `docs/short-name`, `chore/short-name`.
- Commits follow Conventional Commits: `feat(core): resolve events by cluster`, `fix(ingest): back off on 429`.
- One PR does one thing. Aim for under 400 changed lines, excluding fixtures.
- Every PR gets one review from the other person before merge.
- Squash merge. The PR title becomes the commit message.
- The PR description says what changed, why, and how it was tested. Use the template.

## Secrets and config

- `.env` is never committed. `.env.example` lists every variable with a comment.
- API keys live only in `apps/ingest`. The browser never sees them.
- In `apps/web`, any variable starting with `VITE_` is shipped to the browser. Only the Supabase URL and anon key may use that prefix.
- Config is read once at startup, validated with zod, and passed in. No `process.env` reads scattered through the code.

## Logging

- Structured JSON logs from `apps/ingest`, one line per event.
- Every log line carries `source`, `trainNumber` and `journeyDate` when they apply.
- Levels: `error` needs action, `warn` is unusual but handled, `info` is one line per tick, `debug` is off by default.
- Never log API keys or full request headers.

## Dependencies

- Every new dependency is justified in the PR description: what it does and why we can't write it in 30 lines.
- Pin exact versions in `package.json`.
- Prefer small, well-known packages. Check the last release date and weekly downloads before adding one.

## Working with AI

We build with AI. These rules keep the codebase ours.

- AI follows this file and `CLAUDE.md`. If it doesn't, fix the prompt or the docs, not just the output.
- Read every line AI writes before committing. If you can't explain it, ask it to explain or rewrite it simpler.
- AI-written code meets the same review bar as hand-written code. No "the AI did it" in review.
- Ask AI for tests first on anything in `packages/core`, then the implementation.
- Don't let AI add dependencies, change the schema or touch `.env` without saying so in the PR.
