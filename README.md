# Blazefire v2.0

**A pure App Router, Turbopack/Frostfast-first React framework runtime.**

Blazefire v2 is a ground-up rewrite guided by the v1 architecture spec
(`blazefire_v1_spec.json`) — with full feature parity for BlazeFire's
identity: the branding engine, the dev-overlay rebranding, the Frostfast
compiler headers, the custom CLI commands, and the seamless host-injection
pipeline (postinstall + CLI) are all ported, in clean single-source
TypeScript.

## What changed from v1

| v1 hotspot | v2 disposition |
| --- | --- |
| H-01 webpack build tree (147 files + 2,967-line config) | **Gone.** Turbopack-only; a `webpack()` config hook is a hard error |
| H-02 triple HMR stack | **One** event-stream pipeline (`src/dev/hot-reloader.ts`) |
| H-03 pages router | **Gone.** App Router only |
| H-04 mirrored .js/.tsx pairs | **Gone.** One TS source per module; compiled to `dist/` |
| H-05 production MutationObserver | **One-shot in production** (zero observers); dev observers live only while overlay portals are mounted |
| H-08 pretty-printed config re-serialization | Compact JSON + sha256 change gate; unchanged configs are never re-sent |
| H-09 discarded issue marshalling | Suppressed **at the Rust source** via the subscription gate |
| H-13 worker-scheduler re-registration | Idempotent, once per process |
| H-16 update-check network call | **Ported intact** (v1 parity): TTY-only, non-CI, once per 24h, fire-and-forget from `next dev` |
| H-17 postinstall host mutation | **Ported intact** (v1 parity): auto-activation + host hook, opt out with `BLAZEFIRE_SKIP_AUTO=1` |
| H-18 dead code / duplicate branding | Single branding module; single logo asset; injected version constants |

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full module map,
the napi calling conventions, and the complete hotspot disposition matrix.

## Layout

```
blazefire-logo.png          # the ONE logo asset (data URI generated at build)
scripts/generate-logo-data.mjs
scripts/postinstall-entry.mjs  # never-throw shim into dist/postinstall/run.js
src/
  index.ts                  # public API
  plugin.ts                 # next.config wrapper (turbopack.rules only)
  branding.ts               # single source of truth for brand tokens
  version.ts                # version constants
  package-root.ts           # dual-mode package anchor (ESM dist / jest stub)
  cli.ts                    # full v1 command surface (see below)
  config/                   # merge + compact hash-gated serialization
  compiler/                 # Frostfast native contract, binding ladder, project graph
  components/               # React surface: logo + error-overlay layout
  dev/                      # typed HMR protocol + single hot-reloader pipeline
  build/                    # production build orchestrator (Rust writes, JS consumes)
  postinstall/              # activation engine (scanner + driver, shared with CLI)
  runtime/                  # client injection (H-05) + turbopack loader
  update-check/             # feed, throttle, package-manager detection, updater
__tests__/                  # jest suite incl. structural mandate guards
```

## Commands

```bash
npm install
npm run build      # generate logo data + tsc -> dist/
npm test           # jest
npm run typecheck  # tsc --noEmit
```

## Install

> ⚠️ **The name `blazefire` on npm is an unrelated, squatted package.**
> `npm install blazefire` does **not** install this framework — it installs
> a different package someone else owns. Install from GitHub (or from a
> vendored checkout) instead:

```bash
npm install github:arts009009009/Blazefire
# or from a vendored/local copy:
npm install ../path/to/Blazefire
```

## Usage

```ts
// next.config.ts
import blazefire from 'blazefire/plugin'

export default blazefire({
  // your existing config survives — wrapping merges, never replaces
})
```

Installing into a project with a `next.config.*` auto-activates it (v1
behavior): the original is backed up to `Blazefire Backup/` (never
overwritten), the config is wrapped, and a self-perpetuating
`postinstall` hook is chained into the host `package.json`. Opt out with
`BLAZEFIRE_SKIP_AUTO=1`.

### Frostfast native binary

Blazefire's compiler and dev event streams require a Frostfast N-API `.node`
binary. This repository does not bundle that binary or publish an
`@frostfast/native` package. Provide a compatible binary before invoking the
compiler/build APIs:

```bash
FROSTFAST_NATIVE_PATH=/absolute/path/to/frostfast.<platform-abi>.node
```

Alternatively set `FROSTFAST_NATIVE_DIR` to the directory containing that
file. The loader reports each attempted location when no binding is found;
installing this JavaScript package alone does not provide the native compiler.

Verified on all four package managers — the framework switch itself is
always automatic (no `next.config` edits), with two package-manager-level
script approvals required first where their global security policies block
dependency scripts:

| Manager | Activation |
| --- | --- |
| npm | automatic |
| yarn (classic) | automatic |
| pnpm ≥ 10 | one-time `pnpm approve-builds` (pnpm blocks *all* dependency scripts by default) |
| bun | add `"trustedDependencies": ["blazefire"]` (bun never runs dependency scripts unlisted) |

Locked-down environments (`ignore-scripts=true`, CI, Yarn Berry PnP) fall
back to the same engine via the explicit CLI:

```bash
npx blazefire init       # activate (idempotent; prints what it did)
npx blazefire restore    # original config back, host hook removed
npx blazefire update     # re-install the latest release (cache-purging)
npx blazefire check      # installed vs latest
npx blazefire --version
```

## Status

v2.0 core + identity parity: config, branding, compiler bridge,
dev/build orchestration, client injection, activation engine, update
pipeline, CLI, and the React component surface (logo, error-overlay
layout) — all TypeScript-only, per the single-source mandate.
