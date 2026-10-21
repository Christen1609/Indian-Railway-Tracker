## What

<!-- One or two lines. Which feature ID from docs/PRODUCT.md, if any (e.g. F2.3). -->

## Why

<!-- The problem this solves. -->

## How it was tested

<!-- Tests added or changed. Fixtures used. Anything checked by hand. -->

## Checklist

- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass
- [ ] `packages/core` is still free of I/O, clock and randomness
- [ ] New external data goes through a zod schema
- [ ] Scheduler changes: calls for a full 12951 trip, before and after, are listed below
- [ ] Nothing added that needs payment or a card
- [ ] Bug fixes include a test that failed before the fix
- [ ] Docs updated if behaviour, schema or setup changed
- [ ] New dependencies, schema changes or env vars are listed below

## New dependencies, schema changes, env vars

<!-- Write "None" if none. -->
