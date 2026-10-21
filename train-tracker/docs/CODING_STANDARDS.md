# Coding standards

How we write code here. Tools enforce what they can. This file covers the rest.

If a rule here gets in the way, change the rule in a PR. Don't quietly ignore it.

## The rules that matter most

1. Reuse before you create: functions, files and variables. Follow the checklists below.
2. Comments: one line per function, a couple of words. Nothing else, apart from the two other kinds listed below.
3. `packages/core` is pure. No network, no database, no `Date.now()`, no `Math.random()`. Pass `now` in.
4. Every external response goes through a zod schema before we use it.
5. Units go in names: `delayMin`, `distanceKm`, `latencyMs`.
6. Store UTC, show IST. Time zone math lives only in `packages/core/src/time.ts`.
7. If you can't explain a line in an interview, it doesn't merge. This applies double to AI-written code.

## Comments

Only three kinds of comment are allowed.

1. **Function line.** One line above every function: a couple of words on what it does.
2. **Output line.** One line where a function uses another function's output: what that output is, and which function it came from.
3. **Features line.** One line at the top of a file that holds more than one feature, listing them.

```ts
// Features: pace, caps, windows, position, late

/** Next arrival window */
export function nextWindow(section: Section, departedAt: number, caps: Caps): Window {
  const pace = recentPace(section.history); // last 2 sections' pace, from recentPace
  const cap = sectionCap(section, caps);    // fastest allowed pace, from sectionCap
  ...
}
```

Nothing else. In particular:

- No comments explaining what a line does.
- No comments explaining why. If the why matters, it goes in the docs.
- No comments on where a number comes from. Give the constant a clear name. The source goes in the docs.
- No TODOs. Open an issue instead.
- No commented-out code. Git remembers it.
- No history ("changed this because..."). That goes in the commit message.

If code needs more than this to be understood, rename things or simplify the code first.

This applies to TypeScript, TSX and SQL migrations. The SQL in ARCHITECTURE.md has notes for humans. Leave those notes out of migrations.

## Functions: reuse first

Before writing a new function, go through these in order. Stop at the first yes.

1. Does an existing function already do this? Use it.
2. Can an existing function do it by building on what it already does, without breaking its callers? Extend it.
3. Does an existing function produce an output the new work can build on? Write the new function so it calls the old one and uses its output. Add an output line on that call. Never copy the old function's logic.
4. Only if all three are no: write a brand new function.

A new feature does not mean new functions. Most new features should be new callers of existing functions.

Other rules:

- A function does one job, named with a verb: `nextWindow`, `parseRailRadar`.
- Prefer plain functions over classes. Use a class only for state that lives across calls, like the scheduler.
- Export only what other files use.
- No default exports.

## Files: only when needed

Before creating a new file, go through these in order.

1. Does the new code build on functions in an existing file? Put it in that file.
2. If that file now holds more than one feature:
   - Rename it so the name covers all of them. Generic enough to fit them all, specific enough to tell what's inside.
   - Add or update its features line.
   - Say so in the PR: "This file now holds: search, demo picker."
3. Create a new file only when a feature needs its own set of functions that build on nothing existing, and adding them to an existing file would mix unrelated code.

Examples from this repo:

- Pace, caps, windows, position and late handling all build on each other. One file: `estimate.ts`.
- Each source's parser shares nothing with the others. One file per source.

More rules:

- A file over about 400 lines is a sign it holds too much. Say so in the PR. Don't split it without agreeing first.
- No barrel files (`index.ts` that only re-exports).

## Variables

- Reuse before you create. If a value already sits in a variable, use that variable.
- No copies and no renamed duplicates. `const result = windows; return result;` is just `return windows;`.
- Reuse means no duplicates. It does not mean reassigning one variable to hold something different. One variable, one meaning.
- Names must be clear to any engineer and as short as possible.

| Too short | Good | Too long |
|-----------|------|----------|
| `d` | `delayMin` | `currentTrainDelayInMinutes` |
| `w` | `window` | `nextStationArrivalWindowObject` |
| `sc` | `stationCode` | `stationCodeFromTheApiResponse` |
| `p` | `pace` | `recentSectionPaceRatio` |

- Single letters only for loop counters.
- Units in the name when a number has a unit.
- Use the words in `docs/GLOSSARY.md`. Say `journey`, not `trip` or `run`.

## Naming

| Thing | Style | Example |
|-------|-------|---------|
| Files and folders | kebab-case | `estimate.ts`, `railradar.ts` |
| Types, interfaces, React components | PascalCase | `ResolvedEvent`, `StopList` |
| Functions and variables | camelCase | `nextWindow` |
| Constants | UPPER_SNAKE_CASE | `AGREE_WINDOW_MIN` |
| Booleans | `is`, `has`, `should` prefix | `isLate` |
| Database columns | snake_case | `journey_date` |

- Functions are verbs. Types are nouns.
- Station codes and train numbers are `string`, never `number`. Train numbers can have leading zeros, like `01756`.

## Language and tooling

- TypeScript, `strict: true` and `noUncheckedIndexedAccess: true`.
- No `any`. Use `unknown` and narrow it.
- No non-null assertions (`!`) outside tests.
- Prettier formats. ESLint with `typescript-eslint` recommended rules lints. If the tools accept it, it's fine. No style debates in review.
- `pnpm lint`, `pnpm typecheck` and `pnpm test` must pass before a PR is opened.

## Errors

- Adapters never throw. They return `RawFetch` with an `error` field.
- Parsers never throw on bad input. They return `{ events, errors }`.
- Throw only for programmer mistakes: impossible states, broken invariants. Use `assert()` from `packages/core/src/types.ts`, with a message saying what was expected.
- Never swallow an error. Handle it, or log it with context and re-throw.
- Error messages say what happened and what to check: `RailRadar returned 401. Check RAILRADAR_API_KEY in .env.`

## Data from outside

- Each source has one file in `packages/core/src/sources/`, holding its zod schema and its parser.
- Parse with `safeParse`. On failure, return the zod issues as parse errors.
- When a source changes shape: save the new response as a fixture first, then update the schema, then the parser. The failing test proves the fix.

## Time

- Use the helpers in `packages/core/src/time.ts`. Don't call `new Date(string)` on source data; it guesses the time zone.
- Timetable times are minutes from midnight IST on day 1 of the journey (`1952` = 08:32 on day 2).
- Anything that depends on the current time takes `now` as an argument.

## Tests

Vitest. Tests sit next to the file they test: `estimate.ts` and `estimate.test.ts`.

| Layer | What to test | Target |
|-------|-------------|--------|
| `packages/core` | Everything. Parsers on real fixtures, merging as a table of cases, estimate invariants. | 90% line coverage |
| `apps/ingest` | Scheduler, quota guard, backoff, with a fake clock and fake adapters. | Key paths |
| `apps/web` | Formatting helpers and any logic in hooks. UI by hand for now. | Helpers only |

Rules:

- Parser tests use real saved responses from `fixtures/`, never hand-written JSON. Hand-written JSON tests what we think the API sends. Fixtures are for tests only; the app never loads them.
- Merging tests are table-driven. One row per scenario, with a name that says what it proves.
- Pace and window tests check invariants as well as values:
  - The train never passes a station without a confirmed `ARR` or `PASS`.
  - `loKm ≤ km ≤ hiKm` always.
  - `windowStart ≤ windowEnd` always.
  - No pace is ever faster than its section cap.
  - Expected departures are never before timetabled departures.
  - Later windows are never narrower than earlier ones.
- Scheduler tests count calls. A full 12951 trip must stay inside the budget in DATA_SOURCES.md.
- Accuracy scorer tests use small constructed journeys where the right score is easy to work out by hand.
- A bug fix comes with a test that failed before the fix.

## Git and pull requests

- `main` is always deployable. Nobody pushes to it directly.
- Branches: `feat/short-name`, `fix/short-name`, `docs/short-name`, `chore/short-name`.
- Commits follow Conventional Commits: `feat(core): resolve events by cluster`, `fix(ingest): back off on 429`.
- One PR does one thing. Aim for under 400 changed lines, excluding fixtures.
- Every new function and new file is listed in the PR, with the checklist step that allowed it.
- Every PR gets one review from the other person before merge.
- Squash merge. The PR title becomes the commit message.

## Secrets and config

- `.env` is never committed. `.env.example` lists every variable.
- API keys live only in `apps/ingest`. The browser never sees them.
- In `apps/web`, any variable starting with `VITE_` is shipped to the browser. Only public values may use that prefix.
- Config is read once at startup, validated with zod, and passed in. No `process.env` reads scattered through the code.

## Logging

- Structured JSON logs from `apps/ingest`, one line per event.
- Every log line carries `source`, `trainNumber` and `journeyDate` when they apply.
- Levels: `error` needs action, `warn` is unusual but handled, `info` is one line per check, `debug` is off by default.
- Never log API keys or full request headers.

## Dependencies

- Every new dependency is justified in the PR: what it does and why we can't write it in 30 lines.
- Nothing that needs payment or a card.
- Pin exact versions in `package.json`.
- Check the last release date and weekly downloads before adding one.

## Working with AI

- AI follows this file and `CLAUDE.md`. If it doesn't, fix the prompt or the docs, not just the output.
- AI runs the function and file checklists before writing code. Its summary lists every new function and file, and why the checklist allowed it.
- Read every line AI writes before committing. If you can't explain it, ask it to rewrite it simpler.
- AI-written code meets the same review bar as hand-written code.
- Ask AI for tests first on anything in `packages/core`, then the implementation.
- Don't let AI add dependencies, change the schema or touch `.env` without saying so in the PR.
