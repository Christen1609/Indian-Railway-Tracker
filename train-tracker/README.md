# train-tracker

Where is an Indian train right now, and how sure are we?

This project merges several free, unofficial live feeds into one trusted list of station events. It predicts when the train will reach each stop as a time window, based on how fast it actually ran on its last sections. It checks the feeds only when an arrival is due, so free quotas last. Demos run on live data only. Each finished journey is scored against what really happened, then its data is deleted.

Zero spend: everything here runs on free tiers with no card on file.

Working name. A portfolio project built by Christen and Dad, not a business.

## Status

M0, foundation. Docs written. The pnpm workspace, tooling and `packages/core/src/types.ts` are in, and `pnpm lint`, `pnpm typecheck` and `pnpm test` pass. No feature code yet. A single-file prototype of the estimator is published at [indian-railway-tracker.vercel.app](https://indian-railway-tracker.vercel.app), served from `site/` and running on a simulated feed. Its estimator is the earlier model, pace straight from the timetable, and will be replaced rather than copied when `packages/core/src/estimate.ts` lands. Its 8-stop timetable for 12951, with per-stop km checked against etrain.info and ixigo on 17 Oct 2026, is the seed for `packages/refdata`.

## Docs

| Doc | Read it when |
|-----|-------------|
| [docs/PRODUCT.md](docs/PRODUCT.md) | You want to know what we are building, in what order, and what we are not building. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | You are about to write code and need the layout, data model or estimator. |
| [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) | You are touching sources, keys, quotas, parsers or the resolver. |
| [docs/CODING_STANDARDS.md](docs/CODING_STANDARDS.md) | Always. Before your first PR. |
| [docs/AGENTS.md](docs/AGENTS.md) | Several AI agents are working on this repo and you need the roles and lanes. |
| [docs/GLOSSARY.md](docs/GLOSSARY.md) | A word is unclear, or you are naming something. |
| [CLAUDE.md](CLAUDE.md) | You are an AI agent, or you are prompting one. |

## Quick start

Planned for M0. Needs Node 20+, pnpm and the Supabase CLI.

```
git clone <repo>
cd train-tracker
cp .env.example .env      # then add your API keys
pnpm install
pnpm dev
```

There is no offline mode, by design. Before any demo, run `pnpm preflight`.

## Credits

- Station and train data: [datameet/railways](https://github.com/datameet/railways), CC0.
- Map data: © OpenStreetMap contributors, ODbL. Map tiles: OpenFreeMap.
- 3D train: Kenney Train Kit, CC0.
- Live data: RailRadar, RailYatri. Unofficial. Not affiliated with Indian Railways.
