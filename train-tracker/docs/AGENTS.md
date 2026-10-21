# Agents

How several AI agents work on this repo at once without building over each other.

Humans: read `README.md` first. Agents: `CLAUDE.md` is the file you must obey. This one explains the shape of the team.

## The team

Two deciders and two builders. Deciders think and write the contract. Builders write the code against it.

| Agent | Model | Decides | Writes |
|-------|-------|---------|--------|
| Backend decider | Opus | Data model, core types, test specs, what a task means | `packages/core` types, docs, issues, PR reviews |
| Backend builder | Sonnet | Nothing. Asks instead | `apps/ingest`, `supabase`, `packages/core` implementation |
| Frontend decider | Opus | Frontend stack, 3D approach, component contracts, design | Docs, issues, PR reviews |
| Frontend builder | Sonnet | Nothing. Asks instead | `apps/web` |

Builders do not make judgment calls. When a task needs one, the builder stops and says what it needs. A builder guessing is how two agents end up with two different answers to the same question.

## Context does not cross agents. Only the repo does

No agent can see another agent's reasoning. A decision that exists only in a chat is gone when that session ends, and the next agent will decide it differently.

So every decision lands as one of these, strongest first:

1. **A type** in `packages/core/src/types.ts`. Strongest, because an agent that assumes the wrong shape fails `pnpm typecheck` instead of shipping the mistake.
2. **A doc edit.** Deciders only. The Decisions table in `docs/ARCHITECTURE.md` is the log: one line of why, moved from Open to Decided. Do not delete history.
3. **An issue** with acceptance criteria.

If a decision fits none of those, it is not a decision yet.

## Lanes

`CLAUDE.md`, Lanes, owns the path table. It is the file every agent reads, so it is the one place the lanes are written.

One rule, worth repeating here: if your task needs a file outside your lane, stop and say so in your summary. Do not edit it.

## Each agent gets its own checkout

Two agents in one working directory will overwrite each other's uncommitted edits. No document prevents that. Separate checkouts do.

```
git worktree add ../tt-ingest feat/ingest
git worktree add ../tt-web feat/web
```

One worktree per agent, one branch per agent, merging through PRs into `main`.

## What a builder gets handed

A task is not a milestone. "Build M1" fails. A task is:

- **One feature ID** from `docs/PRODUCT.md`, like F3.1
- **The done condition**: which tests go green, or what `pnpm calls 12951` must report
- **Which doc sections apply**, named. Not "read the docs"
- **The lane** it touches

Naming the sections matters twice over: it keeps a smaller model on the relevant rules, and it is most of the token saving. The docs are over a thousand lines and a builder does not need all of them for one parser.

## What a builder may not do

- Edit `docs/`, `CLAUDE.md` or `README.md`. Propose the change in the PR and a decider writes it. One voice in the docs
- Add a dependency, change the schema or touch `.env` without saying so in the PR
- Create a function or file without naming the checklist step that allowed it
- Decide anything in the Open table in `ARCHITECTURE.md`

## Review order

Builder opens the PR. The decider for that lane reviews it against `docs/CODING_STANDARDS.md` and rejects what fails. Christen reads what survives.

The order exists because four agents open PRs faster than one person can read them, and rule 7 says code that cannot be explained in an interview does not merge. Keeping PRs under 400 lines is what makes the last step possible.

## Tests are the handoff

The cheapest reliable split: the decider writes the test, the builder makes it pass. The standards already require test-first in `packages/core`, and the invariant list in the tests section is a spec a builder can work against without judgment.

## When lanes have to meet

The seam between ingest and web is `packages/core/src/types.ts` and the `train_state` row. Both lanes import the same types, so neither can drift quietly.

The frontend lane has nothing live to render until M1 lands, so it is blocked on the backend lane. How to unblock it is an open question in the `ARCHITECTURE.md` Decisions table. Until it is decided, the frontend lane builds types and contracts, not screens.
