/**
 * Frostfast binding loader — the direct JS→Rust load ladder.
 *
 * v2 binds the native Frostfast binary directly (mandate 3). There is no
 * `next/dist/build/swc` indirection, no download-into-node_modules fallback
 * ladder, and no wasm side-path: the binary ships as an npm package or a
 * local Rust build, and a missing binary is a hard, informative error.
 *
 * Fixes carried from v1's hotspot list:
 *  - H-18: version check runs against a value that is ACTUALLY injected
 *    (src/version.ts), so it can never warn spuriously
 *  - H-13: registerWorkerScheduler is registered ONCE per process, not
 *    re-overwritten on every createProject
 *  - H-20: load-failure diagnostics are keyed per error code, so distinct
 *    failures are never swallowed by a single boolean dedupe
 */

import { createRequire } from 'node:module'
import { arch, platform } from 'node:process'
import { isAbsolute, join, resolve } from 'node:path'
import { Worker } from 'node:worker_threads'
import type { FrostfastBinding } from './native-contract.js'
import { FROSTFAST_VERSION } from '../version.js'
import { PACKAGE_ROOT } from '../package-root.js'

/** napi platformArchABI, e.g. linux-x64-gnu, linux-x64-musl, darwin-arm64. */
export function platformArchABI(): string {
  const os = platform
  const cpu = arch
  if (os === 'darwin') return `${os}-${cpu}`
  if (os === 'win32') return `${os}-${cpu}-msvc`
  if (os === 'linux') return `${os}-${cpu}-${detectLinuxLibc()}`
  return `${os}-${cpu}`
}

/**
 * musl (Alpine — extremely common in Docker) vs glibc. napi publishes
 * SEPARATE `*-musl` and `*-gnu` packages, so hard-coding `-gnu` hard-failed
 * every musl host even with a correct musl binary installed.
 */
function detectLinuxLibc(): 'musl' | 'gnu' {
  try {
    const report = (
      process as unknown as {
        report?: { getReport?: () => { header?: { glibcVersionRuntime?: string } } }
      }
    ).report
    const header = report?.getReport?.()?.header
    // glibc reports a runtime version; musl reports none.
    return header?.glibcVersionRuntime ? 'gnu' : 'musl'
  } catch {
    return 'gnu'
  }
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const out: string[] = []
  for (const v of values) if (v && !out.includes(v)) out.push(v)
  return out
}

export interface LoadLadderDeps {
  /** Read an env var (injectable for tests). */
  env: (name: string) => string | undefined
  /** require() an absolute .node path (injectable for tests). */
  requireNative: (absolutePath: string) => FrostfastBinding
  /** Try to resolve a specifier from a base dir; null when unresolvable. */
  resolveFrom: (baseDir: string, specifier: string) => string | null
  warn: (message: string) => void
}

export interface LadderAttempt {
  source: string
  ok: boolean
  detail: string
}

export class FrostfastBindingError extends Error {
  override name = 'FrostfastBindingError'
  constructor(
    message: string,
    readonly attempts: LadderAttempt[]
  ) {
    super(message)
  }
}

export function defaultDeps(): LoadLadderDeps {
  return {
    env: (name) => process.env[name],
    // All ladder paths are absolute, so the require anchor only needs to be
    // absolute too; avoid module-relative resolution for this native load.
    requireNative: (p) =>
      createRequire(join(process.cwd(), 'noop.js'))(p) as unknown as FrostfastBinding,
    resolveFrom: (baseDir, specifier) => {
      try {
        return createRequire(join(baseDir, 'noop.js')).resolve(specifier)
      } catch {
        return null
      }
    },
    warn: (message) => console.warn(message),
  }
}

/**
 * Walk the ladder and return the first binding that loads.
 *
 *   1. FROSTFAST_NATIVE_PATH       — explicit absolute .node (overrides all)
 *   2. FROSTFAST_NATIVE_DIR        — local Rust build: <dir>/frostfast.<abi>.node
 *   3. @frostfast/native           — meta package: native/frostfast.<abi>.node
 *   4. @frostfast/<platformArchABI>— per-platform npm package
 *
 * On Linux every `abi`-bearing rung enqueues BOTH libc triples — the
 * detected one first, the other second (L-23): libc detection reads
 * `process.report`, which is unavailable in bare Docker/scratch images, and
 * one wrong guess must degrade to a second attempt instead of a permanent
 * "not found" pointing the user at the wrong package forever.
 */
export function loadFromLadder(deps: LoadLadderDeps = defaultDeps()): {
  binding: FrostfastBinding
  source: string
  attempts: LadderAttempt[]
} {
  const abi = platformArchABI()
  // Non-Linux triples carry no libc suffix and stay single-candidate.
  const abis = abi.endsWith('-gnu')
    ? [abi, abi.replace(/-gnu$/, '-musl')]
    : abi.endsWith('-musl')
      ? [abi, abi.replace(/-musl$/, '-gnu')]
      : [abi]
  const attempts: LadderAttempt[] = []
  const cwd = deps.env('INIT_CWD') ?? process.cwd()

  // Candidate anchors for package resolution, most-specific first: this
  // package's own location (blazefire's deps live here), the running
  // process's cwd, and the directory the package manager was invoked from
  // (INIT_CWD). Anchoring on a single dir broke monorepos.
  const bases = uniqueStrings([PACKAGE_ROOT, process.cwd(), deps.env('INIT_CWD')])
  const resolveAny = (specifier: string): string | null => {
    for (const base of bases) {
      const hit = deps.resolveFrom(base, specifier)
      if (hit) return hit
    }
    return null
  }

  // Rung-major, abi-minor: the DIR rung stays preferred over the npm
  // packages regardless of libc, and within a rung the detected libc's
  // candidate is attempted before the cross-try.
  const candidates: Array<{ source: string; path: string | null }> = [
    {
      source: 'FROSTFAST_NATIVE_PATH',
      path: (() => {
        const p = deps.env('FROSTFAST_NATIVE_PATH')
        if (!p) return null
        // Resolve a relative override against the project dir instead of
        // silently dropping it and misreporting "not configured".
        return isAbsolute(p) ? p : resolve(cwd, p)
      })(),
    },
    ...abis.map((candidateAbi) => ({
      source: 'FROSTFAST_NATIVE_DIR',
      path: (() => {
        const dir = deps.env('FROSTFAST_NATIVE_DIR')
        if (!dir) return null
        // Resolve against the project dir like the PATH rung above: a bare
        // relative specifier would be resolved by require() as an npm
        // PACKAGE name (node_modules lookup), not as the path it is.
        return join(
          isAbsolute(dir) ? dir : resolve(cwd, dir),
          `frostfast.${candidateAbi}.node`
        )
      })(),
    })),
    ...abis.map((candidateAbi) => ({
      source: '@frostfast/native',
      path: resolveAny(`@frostfast/native/native/frostfast.${candidateAbi}.node`),
    })),
    ...abis.map((candidateAbi) => ({
      source: `@frostfast/${candidateAbi}`,
      path: resolveAny(`@frostfast/${candidateAbi}/frostfast.${candidateAbi}.node`),
    })),
  ]

  for (const candidate of candidates) {
    if (!candidate.path) {
      attempts.push({ source: candidate.source, ok: false, detail: 'not configured/resolvable' })
      continue
    }
    try {
      const binding = deps.requireNative(candidate.path)
      checkVersion(binding, candidate.source, deps.warn)
      return { binding, source: candidate.source, attempts }
    } catch (error) {
      attempts.push({
        source: candidate.source,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // Name every triple that was probed (L-23) — a single guessed libc must
  // never be reported as THE platform when both were tried.
  throw new FrostfastBindingError(
    `Frostfast native binding not found for ${abi} (tried ${abis.join(' and ')}). ` +
      'Install @frostfast/native, or point FROSTFAST_NATIVE_PATH / ' +
      'FROSTFAST_NATIVE_DIR at a built ' +
      abis.map((candidateAbi) => `frostfast.${candidateAbi}.node`).join(' or ') +
      '.\nAttempts:\n' +
      attempts.map((a) => `  - ${a.source}: ${a.detail}`).join('\n'),
    attempts
  )
}

/**
 * Version check that can actually fire (v1 read a variable that was never
 * assigned). Keyed per error code so distinct failures are never swallowed.
 */
const warnedVersionCodes = new Set<string>()
function checkVersion(binding: FrostfastBinding, source: string, warn: (m: string) => void) {
  const bound = binding.FROSTFAST_VERSION
  if (!bound || bound === FROSTFAST_VERSION) return
  const code = `version:${source}:${bound}`
  if (warnedVersionCodes.has(code)) return
  warnedVersionCodes.add(code)
  warn(
    `blazefire: Frostfast binding from ${source} reports v${bound}, but this runtime ` +
      `is contract-tested against v${FROSTFAST_VERSION}.`
  )
}

// ---------------------------------------------------------------------------
// Per-process memo (v1 kept this shape and it was right: one graph engine
// per process). pendingBindings coalesces racing loads.
// ---------------------------------------------------------------------------

let pendingBindings: Promise<{ binding: FrostfastBinding; source: string }> | undefined
let loadedBindings: FrostfastBinding | undefined

export async function loadFrostfastBinding(
  deps: LoadLadderDeps = defaultDeps()
): Promise<FrostfastBinding> {
  if (loadedBindings) return loadedBindings
  pendingBindings ??= Promise.resolve().then(async () => {
    // napi IO wants a big stack and blocking stdio; set before first load.
    process.env.RUST_MIN_STACK ??= '8388608'
    const { binding, source } = loadFromLadder(deps)
    loadedBindings = binding
    return { binding, source }
  })
  const pending = pendingBindings
  try {
    const { binding } = await pending
    return binding
  } catch (error) {
    if (pendingBindings === pending) pendingBindings = undefined
    throw error
  }
}

/**
 * Sync accessor — NATIVE ONLY, never loads (same contract as v1).
 * Any caller in a process that has not awaited loadFrostfastBinding() first
 * gets a precise error rather than a half-initialized engine.
 */
export function loadFrostfastBindingSync(): FrostfastBinding {
  if (!loadedBindings) {
    throw new FrostfastBindingError(
      'Frostfast bindings are not loaded. await loadFrostfastBinding() before loadFrostfastBindingSync().',
      []
    )
  }
  return loadedBindings
}

export function isBindingLoaded(): boolean {
  return loadedBindings !== undefined
}

/** Test-only: clear the per-process memo. */
export function resetBindingMemoForTests(): void {
  pendingBindings = undefined
  loadedBindings = undefined
  warnedVersionCodes.clear()
}

// ---------------------------------------------------------------------------
// Worker-scheduler registration (spec H-13): the global napi hook must be
// registered once per process, NOT overwritten on every projectNew.
// ---------------------------------------------------------------------------

let workerSchedulerRegistered = false

export function ensureWorkerScheduler(
  binding: FrostfastBinding,
  create: (creation: { options: { filename: string; cwd: string } }) => number,
  terminate: (termination: { id: number }) => void
): boolean {
  if (workerSchedulerRegistered) return false
  // A binding (or a test mock) without the hook has nothing to register.
  if (typeof binding.registerWorkerScheduler !== 'function') return false
  binding.registerWorkerScheduler(create, terminate)
  workerSchedulerRegistered = true
  return true
}

// --- default JS worker scheduler (spec H-13) ------------------------------
// Rust schedules JS workers through this global hook. v2 wires it to real
// node:worker_threads so Frostfast's worker-backed features actually run —
// and registers it exactly ONCE per process (never re-overwritten per project).
const activeWorkers = new Map<number, Worker>()
let nextWorkerId = 1

function createJsWorker(creation: { options: { filename: string; cwd: string } }): number {
  const id = nextWorkerId++
  const filename = isAbsolute(creation.options.filename)
    ? creation.options.filename
    : resolve(creation.options.cwd, creation.options.filename)
  const worker = new Worker(filename)
  worker.unref() // an idle scheduled worker must never keep the process alive
  worker.once('exit', () => activeWorkers.delete(id))
  worker.once('error', () => activeWorkers.delete(id))
  activeWorkers.set(id, worker)
  return id
}

function terminateJsWorker(termination: { id: number }): void {
  const worker = activeWorkers.get(termination.id)
  if (!worker) return
  activeWorkers.delete(termination.id)
  void worker.terminate()
}

/** Register the default node:worker_threads scheduler once per process (H-13). */
export function ensureDefaultWorkerScheduler(binding: FrostfastBinding): boolean {
  return ensureWorkerScheduler(binding, createJsWorker, terminateJsWorker)
}

/** Test-only: clear the scheduler registration latch. */
export function resetWorkerSchedulerForTests(): void {
  workerSchedulerRegistered = false
}
