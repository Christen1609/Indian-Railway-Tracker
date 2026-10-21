# CLAUDE.md

Instructions for AI coding agents working in this repo. Humans: read `README.md` first.

## What this is

A live tracker for Indian trains. It merges several free, unofficial feeds into one set of station events, predicts arrival at each stop as a time window from the train's recent pace, and checks the feeds only when an arrival is due. Portfolio project, not a product. Details in `docs/PRODUCT.md`.

## Read before writing code

- `docs/PRODUCT.md` for features, constraints and what is out of scope.
- `docs/ARCHITECTURE.md` for layout, data model, pace and windows.
- `docs/DATA_SOURCES.md` before touching adapters, the scheduler, parsers or merging.
- `docs/CODING_STANDARDS.md` for how code is written.
- `docs/GLOSSARY.md` for the words to use.
- `docs/AGENTS.md` if you are one of several agents on this repo, for roles and handoffs.

## Lanes

Several agents work here at once. Stay in your lane.

| Path | Owner |
|------|-------|
| `apps/ingest/**`, `supabase/**` | backend builder |
| `apps/web/**` | frontend builder |
| `packages/core/**` | backend lane writes. The frontend lane imports, never edits |
| `packages/refdata/**` | backend lane |
| `docs/**`, `CLAUDE.md`, `README.md` | deciders only. Builders propose in the PR |
| `package.json`, `pnpm-lock.yaml`, `supabase/migrations/**` | one agent at a time, announced in the PR |

If your task needs a file outside your lane, stop and say so in your summary. Do not edit it.

Two agents adding dependencies at once produce lockfile conflicts, and two agents numbering a migration `003_` collide. That is why the last row exists.

## Hard rules

1. Zero spend. Never add a service, plan or library that needs payment or a card on file.
2. Live data only. No recording, replay or demo fixtures anywhere in the app. Fixtures exist for parser tests only.
3. Never poll on a timer. A journey is checked only when its arrival window is open, it is running late, or it gets its catch-up check. See DATA_SOURCES.md, "When we check".
4. Never show source names, trust scores or raw feed data in `apps/web`.
5. `packages/core` is pure. No `fetch`, no database, no `Date.now()`, no `Math.random()`, no `process.env`. Time comes in as `now`.
6. All network calls live in `apps/ingest/src/adapters`. All SQL lives in `apps/ingest/src/db`.
7. Validate every external response with zod before use.
8. Units in names: `delayMin`, `distanceKm`, `latencyMs`.
9. Store UTC, display IST. Time zone math only in `packages/core/src/time.ts`.
10. Station codes and train numbers are strings.
11. Compute delay from confirmed time minus timetable. Never copy a source's delay.
12. Never put API keys in `apps/web` or in any `VITE_` variable.
13. No new dependencies, schema changes or `.env` changes without saying so clearly in your summary.
14. No commented-out code. No TODOs. Open an issue instead.
15. Reuse before you create. Run the function and file checklists in `docs/CODING_STANDARDS.md` before writing either.
16. Comments: a one-line function comment, an output line where you use another function's output, a features line on a file holding more than one feature. Nothing else.

## How to work

- Write or update the test first for anything in `packages/core`.
- Parser tests use real responses from `fixtures/<source>/`. If you need a fixture that doesn't exist, stop and ask for one. Don't invent API responses.
- Any change to the scheduler must show, in the PR, how many calls a full 12951 trip costs before and after.
- Keep changes small and on one topic. One PR does one thing.
- Your summary lists every new function and new file, with the checklist step that allowed it.
- The why goes in the docs, never in a comment. If a rule or number needs explaining, explain it in `docs/`.
- If a doc is wrong or out of date, fix the doc in the same change and say so.
- If a task conflicts with these rules, say so before writing code.

## Commands

Working now:

```
pnpm install          # install everything
pnpm test             # all tests
pnpm lint             # ESLint + Prettier check
pnpm typecheck        # tsc across the workspace
pnpm format           # Prettier write
```

Not built yet. Add each one here as it lands:

```
pnpm dev              # web + ingest in watch mode, against local Supabase
pnpm preflight        # before any demo: keys, calls left, API speed, trains running now
pnpm calls 12951      # dry run: how many calls a full trip of this train would cost
```
