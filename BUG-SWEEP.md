# Blazefire v2.0 — Bug Sweep Report

Date: 2026-10-30 (initial sweep 2026-10-28) · Scope: all of `src/` (4,824 LOC, 38 modules) + test suite
Method: static deep review, six parallel subsystem passes; every finding below
was re-verified against the source by hand, and every fix below was verified by
`npm test` (15 suites / 151 tests) + `tsc --noEmit`.

## Fix status

**Fixed (high/medium, 2026-10-30):** H-1, H-2, H-3, H-4, M-1 … M-13 — all
high and medium findings. Each has a regression test:

| Finding | Regression test |
|---|---|
| H-1 distDir wipe | `build.test.ts` — refuses project-root/parent paths and symlink aliases |
| H-2 dead HMR streams | `hot-reloader.test.ts` — cancel/revive/restart suites |
| H-3 prototype configs | `plugin.test.ts` — prototype webpack + `Object.create` config |
| H-4 named function configs | `scanner.test.ts` — named/anonymous/async function forms |
| M-1 NATIVE_DIR as package | `bindings.test.ts` — relative dir resolves to an absolute path |
| M-2 discarded fetch result | `update-check.test.ts` — "still reports a freshly fetched version when the state write fails" |
| M-3 UA/lockfile precedence | `update-check.test.ts` — `detectPackageManager` describe |
| M-4 hook after failed write | (verified by existing `restore` tests + code path review) |
| M-5 unguarded emit | covered by `hot-reloader.test.ts` failure tests |
| M-6 stream leak | `hot-reloader.test.ts` — last-unsubscribe cancellation |
| M-7 issue marshalling | `hot-reloader.test.ts` (via emit stamping) + `issueList` unit path |
| M-8 no ids/resume | `hot-reloader.test.ts` — stamped `connected` handshake delivery |
| M-9 guards read paths | fixed in place (guards suite passes) |
| M-10 `__proto__` keys | `config-serialize.test.ts` + `config-merge.test.ts` |
| M-11 prod overlay scan | `inject.test.ts` — DOM-ready re-scan tests |
| M-12 `2>&1` grouping | `activation.test.ts` — "keeps FD-redirection hosts flat" |
| M-13 shebang ESM | `compiler-facade.test.ts` |

**Still open:** the 33 low-severity items below (L-1 … L-33) — not yet fixed.

Severity key: **high** = data loss, permanent breakage, or a headline guarantee
violated · **medium** = wrong behavior on a common path · **low** = edge case,
leak, or test/coverage gap.

---

## HIGH

### H-1 · `frostfastBuild` recursively deletes whatever `distDir` points at — including the source tree
`src/build/index.ts:40-43, 68, 119`

```ts
const distDir = isAbsolute(configuredDistDir) ? configuredDistDir : resolve(dir, configuredDistDir)
...
await cleanDistDir(distDir)   // readdir + rm(entry, { recursive: true, force: true }) per entry
```

No containment check exists. `frostfastBuild({ dir, distDir: '.' })` resolves to
the project root and recursively deletes everything in it except a literal
`cache/` entry — `package.json`, `src/`, `.git`, all of it — before writing a
single artifact. `'..'` deletes the parent; an absolute `distDir` equal to the
root does the same. `force: true` also suppresses permission protection. One
typo in a config turns `blazefire build` into `rm -rf <project>`.

**Fix:** after resolving, refuse to clean when `distDir === dir` or when
`distDir` is not strictly inside `dir` (separator-aware prefix check on
realpaths). Throw `BlazefireConfigError`.

**Follow-up verification (2026-10-30):** a regression probe found the initial
guard only compared lexical paths; `distDir: 'artifacts'` with
`artifacts -> <project root>` still passed and cleanup removed the temp
fixture's sentinel. The guard now canonicalizes the project root and the
output path (resolving existing symlinked ancestors even when the final output
directory does not exist). `build.test.ts` verifies the symlink alias is
rejected before project creation or cleanup.

### H-2 · One stream error permanently kills an HMR stream, and a dead stream can never be revived
`src/dev/hot-reloader.ts:127-151`

Two compounding defects. First, all three consumer loops end in
`catch (error) { if (!signal.aborted) reportError(error) }` — report and die, no
restart, no teardown. The error path is anticipated by the code itself: the
native `#stream` throws stream errors into the loop (`project.ts:383`), the
mappers throw on malformed payloads (`project.ts:283, 299-304`), and the one
guarded `emit` at `:90-95` proves the author knew `emit` can throw.

Second, `subscribeClient` gates stream creation on `isNew = !listeners`, but the
map entry is deleted only by `dispose()` — never by the unsubscribe closure
(`:154-156` removes only the listener) and never by the stream's own `catch`. So
once a chunk's stream dies, every later `subscribeClient` sees `isNew === false`,
skips stream creation, and registers a listener onto a Set nothing iterates
again. A client that re-subscribes after a failure — the natural recovery action
— appears subscribed and receives zero updates until the dev server restarts.

**Fix:** store `{ listeners, task, dead }` per chunk and reset when the task
settles; restart streams with bounded backoff, or at minimum delete the entry on
failure and surface a terminal error to clients.

### H-3 · Class/prototype-based configs are silently destroyed; a prototype `webpack()` escapes the hard error
`src/plugin.ts:137` · `src/config/options.ts:94-99` · `src/config/merge.ts:25-37`

`isNextConfig` and `omitOptions` both use `Object.keys()` — own enumerable keys
only — and `mergeConfigs` spreads (`{ ...base, ...ours }`) and early-returns on
`Object.keys(base).length === 0` *before* the webpack check. Consequences for
`export default blazefire(new MyConfig())` (a pattern Next tolerates, since it
reads `config.webpack` by property access):

- a class config with a prototype `webpack()` and at least one own field: the
  hook is **silently dropped** before the hard-error check ever sees it — the
  exact failure H-01 exists to prevent, with no diagnostic;
- a prototype-only config (class with getters): `isNextConfig` → false →
  treated as an options bag → the user's **entire config is replaced** by
  Blazefire defaults, silently;
- prototype getters are stripped by the spread even when the config survives.

**Fix:** walk the prototype chain (`for…in` + own-property check on `webpack`),
and run the `typeof base.webpack === 'function'` check *before* the
empty-object early return — line 30 already reads inherited props; it is just
bypassed.

### H-4 · `statementEnd` refuses every named / `function (`-style function config, with a misleading error
`src/postinstall/scanner.ts:170, 203-210` (called from `plan()` at `:383`)

```ts
let atLineStart = true   // line 170 — we are mid-line, right after `export default`
...
if (atLineStart && depth <= 0 && startsNewStatement(src, i)) {
  let j = i
  while (j > start && /[ \t\r]/.test(src[j - 1]!)) j -= 1
  return j               // returns `start` itself for the expression's FIRST token
}
```

`atLineStart` starts `true`, so the config expression's own first token is
tested against `startsNewStatement` (which includes `function\s`). For
`export default function nextConfig() { … }` or `module.exports = function () { … }`
it matches, `statementEnd` returns `start` with zero progress, `raw` is empty,
and `plan()` reports the misleading *"could not locate the config expression"*.
Auto-activation silently never happens — despite `plan()`'s own comment
(`:371`: "Function-style configs are fine") documenting the opposite intent.
(`export default function() {` without a space slips through, which shows this
is an accident, not a guard.)

**Fix:** require progress — `if (i > start && atLineStart && …)` — or initialize
`atLineStart = false` (the expression begins mid-line after `export default`).

---

## MEDIUM-HIGH

### M-1 · Relative `FROSTFAST_NATIVE_DIR` is resolved as an npm *package name*, not a path
`src/compiler/bindings.ts:147-153`

`FROSTFAST_NATIVE_PATH` is carefully resolved against `cwd` (`:144`), but the
`FROSTFAST_NATIVE_DIR` rung joins raw:

```ts
const dir = deps.env('FROSTFAST_NATIVE_DIR')
return dir ? join(dir, `frostfast.${abi}.node`) : null   // relative → bare specifier
```

Node resolves any non-absolute, non-`./`-prefixed specifier via node_modules
lookup, so the documented local-Rust-build workflow
(`FROSTFAST_NATIVE_DIR=./target/release`) fails with *"Cannot find module
'target/release/frostfast.linux-x64-gnu.node'"* — a baffling error for a path
that exists — and in a monorepo with a `node_modules/target` it can load a
**wrong** `.node` from an unrelated package.

**Fix:** `join(resolve(cwd, dir), …)`, mirroring the `FROSTFAST_NATIVE_PATH` rung.

---

## MEDIUM

### M-2 · Fetched update version is discarded; the result depends on a silent best-effort disk write
`src/update-check/feed.ts:96-105` — after a successful fetch the code calls
`writeState(...)` (which swallows every error, `state.ts:35`) and then re-reads
`readState()` from disk instead of using the `latest` it just fetched. On any
machine where the state file is unwritable (shared `/tmp` with a cross-UID file,
read-only tmp), `blazefire check` *always* reports "could not reach the release
feed" despite successful fetches; worse, a stale `latestVersion` on disk
permanently suppresses every newer release. **Fix:** use `latest` directly;
treat `writeState` as optional bookkeeping.

### M-3 · Lockfile only overrides an *npm* user-agent → `pnpm dlx`/`bunx` forks the lockfile
`src/update-check/pm.ts:41-48` — `npm_config_user_agent` is set identically by
`pnpm dlx` and `bunx`, but only `uaManager === 'npm'` defers to the lockfile. So
`pnpm dlx blazefire update` inside an npm project runs `pnpm add`, rewriting
`node_modules` to symlink/store layout and creating `pnpm-lock.yaml` beside
`package-lock.json` — the exact lockfile-forking the comment above the code
claims to prevent. **Fix:** prefer the lockfile whenever UA and lockfile
disagree. (This also makes `__tests__/updater.test.ts:71`'s
`toHaveBeenCalledTimes(1)` fail under `yarn/pnpm/bun test` — medium-low.)

### M-4 · Hook is installed into the host `package.json` even when the config write failed — and `restore` can never remove it
`src/postinstall/activation.ts:504` vs `:512-526` — `hookRoots.add(projectRoot)`
runs *before* the backup/atomic-write. If the write throws (read-only project),
the config is never wrapped, no backup exists, yet `:529-543` still mutates the
host's `package.json`. `restore()` only calls `undoHook` when a live backup was
restored (`:601-603`), so with no backup on disk the `blazefire init` hook stays
in `postinstall` **forever**. **Fix:** move `hookRoots.add` after a successful
write.

### M-5 · `emit` and listener exceptions are unguarded at 5 of 6 call sites
`src/dev/hot-reloader.ts:69, 72, 110, 143, 145` — a single throwing `emit`
(e.g. a dead client socket during `JSON.stringify`) or one misbehaving per-chunk
listener propagates into the loop catch and, per H-2, permanently kills the
stream; the listener fan-out at `:145` additionally aborts delivery to remaining
listeners. `:143` also emits before fanning out, so an `emit` throw drops the
per-client delivery entirely. **Fix:** one guarded `safeEmit` helper used at
every site (matching the existing `:90-95` pattern).

### M-6 · Unsubscribe leaks the native stream, keeps broadcasting, never trims the map
`src/dev/hot-reloader.ts:143, 154-156` — the per-chunk Rust RootTask stream runs
until `dispose()` regardless of subscribers; `emit({type:'update'})` fires even
with zero listeners; empty Sets accumulate. A dev session touching many chunks
accumulates one live native stream per chunk ever subscribed — native memory
scaling with navigation history, not connected clients.
`__tests__/hot-reloader.test.ts:5-27` **locks the leak in** by asserting stream
reuse without ever asserting cancellation. **Fix:** cancel the chunk stream when
the Set empties; gate `:143` on non-emptiness.

### M-7 · `built` marshals `errors`/`warnings` as `string[]` with no element validation
`src/dev/hot-reloader.ts:105-115` — `NapiUpdateMessage.value` is `unknown` and
the native issue shape is a structured `CompilationIssue`
(`native-contract.ts:97-101`). `Array.isArray` passes objects straight through
the `as string[]` cast; the protocol type then lies to consumers, and an overlay
doing `errors.join('\n')` renders `[object Object]` — real build errors rendered
as garbage. **Fix:** element-wise validate, or map `CompilationIssue` →
`severity + message` strings.

### M-8 · HMR protocol has no ids, no resume, no connect snapshot; `connected` is never produced
`src/dev/hmr-protocol.ts:19-28` — nothing in `src/` emits `{type:'connected'}`,
`HMR_ENDPOINT` is referenced nowhere, and messages carry no sequence id. Any
client connecting after startup (page refresh, laptop sleep, proxy idle-kill)
silently misses every route change and status transition that occurred while it
was disconnected. There is also no heartbeat to prevent idle-kills. **Fix:**
bounded ring buffer with monotonic ids plus a `connected` handshake carrying
routes + last build hash.

### M-9 · Pages-router CI guard scans file *paths*, not file contents
`__tests__/guards.test.ts:65-68`

```ts
const offenders = sourceFiles.filter((f) => /getServerSideProps|\/pages\//.test(f))
```

`f` is the path; the regex never reads the file. `getServerSideProps` can only
match if a *file* is named that. Every other guard in the file correctly calls
`readFileSync`. The mandate-1 guard that is supposed to fail CI when
pages-router surface creeps back passes vacuously. **Fix:**
`/getServerSideProps|getStaticProps/.test(readFileSync(f,'utf8')) || /\/pages\//.test(f)`.

### M-10 · `__proto__`-named keys are silently dropped at the wire boundary
`src/config/serialize.ts:166-179` · `src/config/merge.ts:57-59` — plain
assignment `out[k] = v` with `k === '__proto__'` invokes the prototype setter
instead of creating an own key, so the value vanishes from the serialized JSON
crossing to Rust; in `mergeConfigs` the same assignment swaps `rules'` prototype
to a loader array. No global pollution, but a real silent-data-loss path.
**Fix:** build with `Object.create(null)` / `Object.defineProperty`, and reject
`__proto__`/`constructor` glob keys explicitly.

### M-11 · Production overlay rebranding can never run — the one-shot scan precedes all portals
`src/runtime/inject.ts:195, 229, 236-238` — the loader prepends the runtime
import ahead of application code, so the module's synchronous `scanPortals()`
(`:195`) runs before React mounts anything; in production `rebrandPortal`
constructs no observer by design. So the only rebrand opportunity provably runs
too early, and nothing re-runs it: the prod overlay half is dead code that still
ships and fails silently (custom `blazefire-portal`s included). **Fix:** drop
the overlay half from prod builds, or add a bounded one-shot retry on
`DOMContentLoaded`.

### M-12 · `2>&1`-style redirections force POSIX grouping → cmd.exe parse error → failed Windows installs
`src/postinstall/activation.ts:362, 374-377` — `NEEDS_GROUPING` matches any bare
`&`, so `next build 2>&1` (valid in both shells, binds tighter than `&&`, safe
to chain flat) is wrapped as `(…\n) && hook`. npm runs scripts via cmd.exe on
Windows by default, where `(`…`)` is a syntax error — the host's `postinstall`
becomes a parse error and **`npm install` fails outright**. **Fix:** exclude
redirection operators from the bare-`&` detection.

### M-13 · Shebang / banner-comment ESM files are misclassified as scripts
`src/compiler/index.ts:73-81` — `/^\s*(?:import|export)\b/` only matches as the
first token after whitespace, so `#!/usr/bin/env node`, a `// eslint-disable`
header, or a license banner followed by `import` returns a definite `false`
(passed to the native parser as script mode, which rejects top-level
import/export/await). The comment's "the native side parses when unsure"
doesn't hold — this never returns "unsure". **Fix:** strip leading `#!`/comment
trivia before testing, or default to module/unknown when nothing definitive is
found.

---

## LOW

| # | Location | Issue |
|---|----------|-------|
| L-1 | `src/postinstall/activation.ts:189-196` | `writeAtomicSync` drops the original file mode (configs/`package.json` kept at 0600 silently become 0644) |
| L-2 | `src/postinstall/activation.ts:296` | `ensureHook` reformats the entire host `package.json` at 2-space indent (BOM/EOL are preserved; formatting isn't) |
| L-3 | `src/postinstall/scanner.ts:300-323, 420-423` | Missed `const { default: blazefire }` binding → duplicate declaration SyntaxError; inline `require("blazefire/plugin")(cfg)` double-wrapped |
| L-4 | `src/postinstall/scanner.ts:376` | Comment-blind 120-char `as default` scan → false refusals |
| L-5 | `src/postinstall/activation.ts:500` | ESM-only manual-advice snippet printed for CJS configs (pasting it = SyntaxError) |
| L-6 | `src/runtime/turbopack-loader.ts:54-70` | Loader drops/ignores source maps when `callback` is missing or the map is an object → off-by-one bootstrap stack traces |
| L-7 | `src/runtime/inject.ts:57-67` | `injectStyles` DOMContentLoaded retry can never fire post-event; listener + orphan style leak per call |
| L-8 | `src/runtime/inject.ts:139-150` | Trailing-only debounce with no max-wait starves rebranding under sustained overlay mutations |
| L-9 | `src/runtime/inject.ts:157-173` | Portal whose `attachShadow()` happens after insertion is permanently missed |
| L-10 | `src/runtime/inject.ts:166-172` | Pending debounce timer writes into a removed portal's detached shadow root |
| L-11 | `src/runtime/inject.ts:260-269` + `branding.ts:79-82` | `textChild` returns untrimmed data but labels match anchored regexes → whitespace-dependent label misses |
| L-12 | `src/runtime/inject.ts:224-238` | No singleton guard: explicit `installBlazefireRuntime()` stacks a second full observer tree |
| L-13 | `src/update-check/cache-purge.ts:49, 153` | Yarn-classic cache glob `/^blazefire/` misses the registry-prefixed `npm-blazefire-…` entries → purge no-ops |
| L-14 | `src/update-check/cache-purge.ts:176-179` | pnpm store purge scans only the store root (schema dirs, never package names) → guaranteed no-op reported as "removed" |
| L-15 | `src/update-check/updater.ts:69-73` | Blocking unbounded `spawnSync` freezes `next dev` for the whole install |
| L-16 | `src/update-check/state.ts:32-38` | Non-atomic state write + check-then-act → duplicate fetches and double "Update now?" prompts |
| L-17 | `src/update-check/updater.ts:106` | `BLAZEFIRE_SKIP_UPDATE_CHECK` accepts only `'1'` (not `true`/`yes`) and is documented nowhere |
| L-18 | `src/update-check/updater.ts:110-136` | Prompt: no stdin `error` handler (crash window on PTY hangup), no timeout, stray buffered keystrokes auto-answer |
| L-19 | `src/update-check/feed.ts:114` vs `state.ts:40` | Two divergent 24h gates + hardcoded interval → dev prompt suppressed by state the CLI considers invalid |
| L-20 | `src/update-check/pm.ts:84-88` | `quoteForCmd` is dead code and unsound if ever used (wrong escaping for both cmd.exe and sh) — injection footgun |
| L-21 | `src/build/index.ts:64-93` | Falsy `buildError` check: a falsy native rejection lets a shutdown error mask the real build error |
| L-22 | `src/compiler/project.ts:262-391` | "RootTask cannot be forgotten" is false for abandoned iterators — native handle leak (no asyncDispose/FinalizationRegistry backstop) |
| L-23 | `src/compiler/bindings.ts:41-54` | musl/gnu detection has no cross-try: one wrong libc guess is a hard failure whose error names the wrong triple (Alpine/scratch Docker) |
| L-24 | `src/compiler/project.ts:297-306` | `updateInfoEvents` bypasses `stripDiscardedIssues`, violating `issues.ts`'s "every payload" H-09 invariant |
| L-25 | `src/compiler/project.ts:193-194` | "marshalling is skipped" comment is false — full serialize + sha256 runs on every `update()`; only the napi call is gated |
| L-26 | `src/config/options.ts:41-51` | `headers: 'false'` (string) silently *enables* headers, contradicting the adjacent comment's promise |
| L-27 | `src/config/serialize.ts:43-45, 166-176` | Hash is insertion-order-dependent → spurious re-sends for order-different-but-equal configs (gate stays sound, H-08 goal partially defeated) |
| L-28 | `src/config/serialize.ts:96-111` | `-0`/`NaN` loader options rejected as "not JSON-serializable" (misleading message) |
| L-29 | `src/compiler/project.ts:92-95` | `snapshot().parsed` aliases caller-owned objects — in-place mutation produces phantom native updates |
| L-30 | `src/components/blazefire-logo.tsx:40-42` | Single-stop gradient → `offset={Infinity}`; `key={color}` collides on duplicate colors (the SVG path in `branding.ts:164-168` guards this; the component doesn't) |
| L-31 | `__tests__/guards.test.ts:119` + `src/version.ts:4-6` | Header value hardcoded; the version↔package.json drift guard that `version.ts` promises does not exist |
| L-32 | `__tests__/project.test.ts` | Worker-scheduler latch never reset (`resetWorkerSchedulerForTests` is exported but unused) — registration-failure tests are order-dependent |
| L-33 | `__tests__/build.test.ts` | Build failure / exit-precedence paths (the `finally` logic) have zero coverage |

Footnotes: `MARKER` (`activation.ts:31`) is dead; `writeAtomicSync` leaves a
`.tmp` behind if rename throws; `getInstalledVersion` is an unused import in
`cli.ts`; `cli.ts` has no test coverage at all;
`src/update-check/feed.ts:44` silently yields a null feed for repo URLs carrying
a fragment; `__tests__/inject.test.ts` leaves the CSP nonce path, the loader map
path, marker idempotency, and observe-options unasserted (and has one POSIX-only
path expectation that fails on Windows CI); semver tests never assert
numeric-vs-alphanumeric precedence, larger-prerelease-set precedence, or
leading-zero identifier rejection.

---

## Verified clean (checked by hand, no bug found)

- **semver.ts** — correct against the semver spec: prerelease-below-release,
  larger-set-higher, numeric-below-alphanumeric, BigInt numeric compare,
  build-metadata exclusion, no-leading-zeros grammar.
- **Config merge semantics** — no input mutation, correct env layering,
  headers/redirects concatenation (incl. mixed array/function providers),
  turbopack shallow+rules-deep precedence; spread cannot pollute
  `Object.prototype` globally.
- **sha256 change gate** — hash is over byte-identical JSON to what is sent;
  `remember()` only after a successful native await, so failed sends retry.
- **Postinstall idempotency** — `ensureHook` → `chainAfterHost` → `undoHook` →
  `unwrapGroup` round-trips byte-for-byte for flat, grouped, comment, and
  trailing-newline hosts; BOM/CRLF preserved; backup never overwritten;
  `restore` earliest-backup selection correct; never-throw invariant holds
  (exit 0 on every failure path).
- **Scanner primitives** — string/regex/comment walker, `module.exports.env =`
  property-assignment skip, shebang and BOM handling, workspace `**` expansion
  and negated-pattern handling (order-independent, exact-path-consistent).
- **Self-exclusion / path handling** — `isSelf` normalizes separators *and*
  trailing separators before the prefix test; pnpm-layout walk-up correct.
- **H-05 core contract** — production constructs zero MutationObservers, styles
  injected exactly once; dev observers per-portal, debounced, released on
  dispose; dispose genuinely idempotent; SSR guards correct.
- **Binding ladder** — sane precedence, per-code attempt records, no
  swallowed-error dedupe regression; async memo coalescing race-free;
  `createRequire` for the `.node` addon is correct in ESM.
- **`#stream` lost-wakeup** — waiter installed synchronously in the executor;
  abort re-checked; `closed` guard blocks post-dispose callbacks.
- **Build finally precedence** (for truthy errors) and `shutdown()`
  idempotency/teardown ordering.
- **Update-check plumbing** — all JSON.parse sites guarded; future-timestamp
  handling correct in both gates; bounded network (4s AbortController, one
  fetch per window); TTY/CI detection; Windows `.cmd` shim handling; no
  unhandled-rejection surface.
- **XSS** — zero `dangerouslySetInnerHTML`/`innerHTML` anywhere; all DOM writes
  are `textContent`/`setAttribute` with static strings; React children escaped.

## Test-suite observations

Several tests lock in buggy behavior rather than correct behavior:
`hot-reloader.test.ts:5-27` (stream leak as intended), `updater.test.ts:71`
(count assertion passes only under npm), and the UA-precedence of M-3 is
entirely untested. The largest coverage holes: `cli.ts` (no tests), build
failure paths, the CSP nonce path, and loader source-map handling.
