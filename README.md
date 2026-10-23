# Blazefire v2.0

**A pure App Router, Turbopack/Frostfast-first React framework runtime.**

Blazefire v2 is a ground-up rewrite guided by the v1 architecture spec
(`blazefire_v1_spec.json`). Where v1 layered branding and a client runtime
over a stock Next.js install — and carried an unbuildable, 239K-line
vendored fork full of webpack/pages-router holdovers — v2 is a single-source
TypeScript codebase that binds the **Frostfast** compiler core (the
incremental Turbo Engine graph, exposed through binary napi contracts)
directly, with zero wrapper cruft.

## What changed from v1

| v1 hotspot | v2 disposition |
| --- | --- |
| H-01 webpack build tree (147 files + 2,967-line config) | **Gone.** Turbopack-only; a `webpack()` config hook is a hard error |
| H-02 triple HMR stack | **One** event-stream pipeline (`src/dev/hot-reloader.ts`) |
| H-03 pages router | **Gone.** App Router only |
| H-04 mirrored .js/.tsx pairs | **Gone.** One TS source per module; compiled to `dist/` |
| H-05 production MutationObserver | **One-shot in production** (zero observers); dev observers settle |
| H-08 pretty-printed config re-serialization | Compact JSON + sha256 change gate; unchanged configs are never re-sent |
| H-09 discarded issue marshalling | Suppressed **at the Rust source** via the subscription gate |
| H-13 worker-scheduler re-registration | Idempotent, once per process |
| H-16 update-check network call | **Gone.** Nothing phones home |
| H-17 silent postinstall mutation | **Gone.** Explicit `blazefire init` with preview + `--yes` |
| H-18 dead code / duplicate branding | Single branding module; single logo asset; injected version constants |

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full module map,
the napi calling conventions, and the complete hotspot disposition matrix.

## Layout

```
blazefire-logo.png          # the ONE logo asset (data URI generated at build)
scripts/generate-logo-data.mjs
src/
  index.ts                  # public API
  plugin.ts                 # next.config wrapper (turbopack.rules only)
  branding.ts               # single source of truth for brand tokens
  version.ts                # version constants (test-enforced vs package.json)
  cli.ts                    # explicit activation (init / restore)
  config/                   # merge + compact hash-gated serialization
  compiler/                 # Frostfast native contract, binding ladder, project graph
  dev/                      # typed HMR protocol + single hot-reloader pipeline
  build/                    # production build orchestrator (Rust writes, JS consumes)
  runtime/                  # client injection (H-05) + turbopack loader
__tests__/                  # jest suite incl. structural mandate guards
```

## Commands

```bash
npm install
npm run build      # generate logo data + tsc -> dist/
npm test           # jest
npm run typecheck  # tsc --noEmit
```

## Usage

```ts
// next.config.ts
import blazefire from 'blazefire/plugin'

export default blazefire({
  // your existing config survives — wrapping merges, never replaces
})
```

Activate a project explicitly (never on install):

```bash
npx blazefire init        # prints a preview of the wrap
npx blazefire init --yes  # applies it, with a backup in .blazefire/
npx blazefire restore
```

## Status

This is the v2.0 core skeleton and runtime layer: config, branding,
compiler bridge, dev/build orchestration, client injection, CLI. The React
component surface (devtools panel, error overlay, logo component) is
scheduled for the next increment and will be TypeScript-only, per the
single-source mandate.
