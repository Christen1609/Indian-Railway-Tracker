# train-tracker

Where is an Indian train right now, and how sure are we?

This project merges several free, unofficial live feeds into one trusted list of station events. It predicts when the train will reach each stop as a time window, based on how fast it actually ran on its last sections. It checks the feeds only when an arrival is due, so free quotas last. Demos run on live data only. Each finished journey is scored against what really happened, then its data is deleted.

Zero spend: everything here runs on free tiers with no card on file.

Working name. A portfolio project built by Christen and Dad, not a business.

## Status

The web app is live at [indian-railway-tracker.vercel.app](https://indian-railway-tracker.vercel.app). Its landing page searches for a train over a globe. Train 12951 has a live page with a 3D map, a status card and a stop list. The page reads Supabase directly and updates through Realtime when the worker writes a new `train_state` row. The old `site/` prototype is gone.

The ingest worker and the 12951 timetable loader work. The worker is started by hand on the developer's machine with `pnpm --filter @train-tracker/ingest start 12951`. Where it runs long term is not decided. `pnpm lint`, `pnpm typecheck` and `pnpm test` pass.

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

Needs Node 20+, pnpm and the Supabase CLI.

```
git clone <repo>
cd train-tracker
cp .env.example .env      # then add your keys
pnpm install
pnpm --filter @train-tracker/refdata load         # stations, trains and the 12951 timetable
pnpm --filter @train-tracker/ingest start 12951   # watch train 12951
pnpm --filter @train-tracker/web dev              # the web app
```

There is no offline mode, by design. `pnpm dev` and `pnpm preflight` are not built yet.

## Credits

- Station and train data: [datameet/railways](https://github.com/datameet/railways), CC0.
- Map data: © OpenStreetMap contributors, ODbL. Map tiles: OpenFreeMap and OpenMapTiles.
- Terrain: Mapterhorn.
- Globe imagery: NASA GIBS, Blue Marble.
- Live data: RailRadar, RailYatri, ConfirmTkt. Unofficial. Not affiliated with Indian Railways.
