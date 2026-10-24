# Blazefire v2.0 Architecture

Derived from `blazefire_v1_spec.json` (analysis of v1 at git `6a1772a`).
This document maps every v1 hotspot to its v2 disposition and documents the
Rust/TS boundary.

## 1. Layering

```
┌────────────────────────────────────────────────────────────┐
│ user project (App Router only)                             │
│   next.config.ts -> blazefire()  [plugin.ts]               │
├────────────────────────────────────────────────────────────┤
│ Blazefire v2 runtime (this package, pure TS single-source) │
│   config/    merge + compact hash-gated serialization      │
│   compiler/  native contract + binding ladder + project    │
│   dev/       one HMR pipeline over graph event streams     │
│   build/     production orchestrator                       │
│   runtime/   client injection (dev-scoped observers)       │
│   postinstall/ activation engine (scanner + fs driver)     │
│   update-check/ feed + throttle + updater (v1 parity)      │
│   components/ React surface (logo, error-overlay layout)   │
├────────────────────────────────────────────────────────────┤
│ Frostfast native binary (napi .node)                       │
│   incremental Turbo Engine graph, SWC transforms,          │
│   persistent RocksDB-style cache, HMR event streams        │
└────────────────────────────────────────────────────────────┘
```

v1 had a second layer — an unbuildable 239K-line vendored Next.js fork
(`packages/next`, spec H-19) — that was never shipped. v2 deletes the idea:
the runtime binds the Frostfast binary directly. There is **no**
`next/dist/build/swc` indirection (enforced by `__tests__/guards.test.ts`).

## 2. The napi boundary (mandate 3)

`src/compiler/native-contract.ts` is the TypeScript IDL. Conventions:

| Convention | Detail |
| --- | --- |
| Config blob | ONE compact `JSON.stringify(config)` string (`config/serialize.ts`) |
| Env tuples | `[{name, value}]` flat arrays, never recursive marshalling |
| RegExp | Decomposed to `{type:'regex', value:{source,flags}}` |
| Handles | `Project`/`Endpoint`/`RootTask`/`Lockfile` are opaque; JS only passes them back |
| Event streams | Native callback + `RootTask`; `FrostfastProject.#stream` adapts callbacks to async iteration, disposes the task in `finally`, and honors abort signals |
| Transform | `(source, isModule, Buffer.from(JSON.stringify(options)))` |
| Issue gate | `projectHmrEvents(..., includeIssues)` — with the default `suppress` policy Rust never marshals discarded issues (H-09) |

### Binding ladder (`compiler/bindings.ts`)

1. `FROSTFAST_NATIVE_PATH` — explicit absolute `.node`
2. `FROSTFAST_NATIVE_DIR` — local Rust build (`frostfast.<platformArchABI>.node`)
3. `@frostfast/native` — meta package
4. `@frostfast/<platformArchABI>` — per-platform package

Missing binary = one hard error listing every attempt (nothing swallowed,
spec H-20). The native package is not bundled or published from this repository; consumers
must provide a compatible binary through `FROSTFAST_NATIVE_PATH` or
`FROSTFAST_NATIVE_DIR`. The per-process memo coalesces concurrent loads; the sync
accessor never loads (native-only contract). Version checks compare against
`src/version.ts` — a value that is actually injected (v1 read
`__NEXT_VERSION`, which was never set, and warned spuriously, spec H-18).

## 3. Hotspot disposition matrix

| ID | v1 finding | v2 disposition |
| --- | --- | --- |
| H-01 | webpack tree shipped (147 files, 2,967-line config) | Deleted; `webpack()` in user config is a hard error |
| H-02 | Triple HMR stack (turbopack/webpack/rspack) | One pipeline: `dev/hot-reloader.ts` over graph streams |
| H-03 | Pages router subsystem | Deleted; App Router only |
| H-04 | Mirrored .js/.tsx pairs | Single TS source; `tsc` to `dist/`; structural guard test |
| H-05 | Production document-wide MutationObserver | Prod = one-shot, zero observers; dev observers settle after N no-op passes and are disposed |
| H-06 | Build-trace/worker pools | Rust does tracing; JS worker usage reduced to the napi scheduler (idempotent) |
| H-07 | JS watchers regardless of bundler | Driven by the graph's entrypoints/file-event streams |
| H-08 | Pretty-printed config re-sent every update | Compact JSON + sha256 gate; `project.update()` skips unchanged configs (returns `false`) |
| H-09 | Issues marshalled then discarded | `includeIssues:false` at the subscription + defensive `stripDiscardedIssues` |
| H-10 | Chatty polling/timers | Streams are push-based; the BUILDING defer timer is `unref`'d |
| H-11 | Babel fallback machinery | Deleted |
| H-12 | Broken binary-cache pruning | No JS download ladder exists at all |
| H-13 | Worker scheduler re-registered per project | `ensureWorkerScheduler` registers once per process |
| H-14 | Webpack memory/manifest plugins | Deleted with H-01 |
| H-15 | JS SourceMapConsumer path | Rust `getSourceMap`/`traceSource` bound directly |
| H-16 | update-check on every config evaluation | Ported intact (v1 parity): TTY-only, non-CI, one prompt per rolling 24h, fire-and-forget from config evaluation — never blocks startup, never throws out of `next.config` |
| H-17 | Silent postinstall host mutation | Ported intact (v1 parity): auto-activation + chained host hook on install; `BLAZEFIRE_SKIP_AUTO=1` opts out; `restore` removes the hook; engine is one implementation shared by postinstall and CLI |
| H-18 | Dead code, duplicate branding/logo, stale artifacts | One branding module, one logo asset (generated data URI, gitignored), version constants test-enforced |
| H-19 | Unbuildable vendored fork | Fork deleted as a concept; direct Frostfast binding |
| H-20 | Swallowed binding-load diagnostics | Attempts aggregated per error; version warnings keyed per code |

## 4. Client runtime (mandate 2 detail)

`src/runtime/inject.ts`:

- Theme flags travel as static `process.env.NEXT_PUBLIC_*` member
  expressions so the bundler inlines them (a dynamic read survives into the
  browser as a no-op — the v1 bug that made the toggles unswitchable).
- `NODE_ENV === 'production'`: `installOverlayRuntime(dev=false)` performs a
  single scan and constructs **zero** MutationObservers.
- Dev: one portal-discovery observer plus one per shadow root; each
  shadow-root observer disconnects after `SETTLE_AFTER_PASSES`
  consecutive no-op passes. `dispose()` releases everything.
- `applyOverlayToRoot` is idempotent (every write is conditional), so a
  settled pass performs zero DOM writes.

## 5. Logo asset

`/blazefire-logo.png` is the single stored copy of the emblem (user-provided,
570×570 RGBA). `scripts/generate-logo-data.mjs` derives
`src/generated/logo-data.ts` (gitignored) at build time — v1 shipped the PNG
AND a baked base64 twin, both git-tracked (H-18).

## 6. Activation + update pipeline (v1 identity parity)

One engine, two entry points (v1 rule kept):

- `src/postinstall/scanner.ts` — pure comment/string/regex-aware text
  scanner: `plan()`/`rewrite()` wrap a top-level default export in
  `blazefire(...)`. Idempotent at the engine level (an already-wrapped
  config is refused, so a double wrap is impossible).
- `src/postinstall/activation.ts` — the fs driver: project/workspace
  discovery, Next.js-resolvability check, backup to `Blazefire Backup/`
  (existing backups never overwritten), atomic writes, `.gitignore` note,
  and the chained host `postinstall` hook (never clobbers the host's own).
- `scripts/postinstall-entry.mjs` — the never-throw shim npm runs; missing
  `dist/` (fresh clone pre-build) skips silently.
- `src/cli.ts` — the full v1 command surface (`init|setup|activate`,
  `restore|revert`, `update|upgrade`, `check|outdated`, `--version`,
  `--help`), calling the same engine.
- `src/update-check/` — GitHub Releases feed (4s timeout, silent on every
  failure), 24h throttle state in the OS temp dir, package-manager
  detection (user-agent + lockfiles), per-manager cache purge (yarn
  classic/berry, pnpm virtual store, npm lock entries, bun), and
  `maybeNotify()` — the TTY-only, non-CI, fire-and-forget dev prompt.

## 7. Deferred to the next increment

- Dev-server process wiring (HTTP + WebSocket fanout around
  `createHotReloader`).
- Persistent-cache seeding across worktrees (v1 `turbopack-cache-seed.ts`).
- The full 54-symbol napi surface: v2 binds the subset it consumes; the
  contract file documents how to extend it.
- The devtools-panel React component (the logo + error-overlay layout
  components ship in `src/components/` today).
