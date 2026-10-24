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
import { isAbsolute, join } from 'node:path'
import type { FrostfastBinding } from './native-contract.js'
import { FROSTFAST_VERSION } from '../version.js'

/** napi platformArchABI, e.g. linux-x64-gnu, darwin-arm64, win32-x64-msvc. */
export function platformArchABI(): string {
  const os = platform
  const cpu = arch
  if (os === 'darwin') return `${os}-${cpu}`
  if (os === 'win32') return `${os}-${cpu}-msvc`
  if (os === 'linux') return `${os}-${cpu}-gnu`
  return `${os}-${cpu}`
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
    requireNative: (p) => createRequire(import.meta.url)(p) as unknown as FrostfastBinding,
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
 */
export function loadFromLadder(deps: LoadLadderDeps = defaultDeps()): {
  binding: FrostfastBinding
  source: string
  attempts: LadderAttempt[]
} {
  const abi = platformArchABI()
  const attempts: LadderAttempt[] = []
  const cwd = deps.env('INIT_CWD') ?? process.cwd()

  const candidates: Array<{ source: string; path: string | null }> = [
    {
      source: 'FROSTFAST_NATIVE_PATH',
      path: (() => {
        const p = deps.env('FROSTFAST_NATIVE_PATH')
        return p && isAbsolute(p) ? p : null
      })(),
    },
    {
      source: 'FROSTFAST_NATIVE_DIR',
      path: (() => {
        const dir = deps.env('FROSTFAST_NATIVE_DIR')
        return dir ? join(dir, `frostfast.${abi}.node`) : null
      })(),
    },
    {
      source: '@frostfast/native',
      path: deps.resolveFrom(cwd, `@frostfast/native/native/frostfast.${abi}.node`),
    },
    {
      source: `@frostfast/${abi}`,
      path: deps.resolveFrom(cwd, `@frostfast/${abi}/frostfast.${abi}.node`),
    },
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

  throw new FrostfastBindingError(
    `Frostfast native binding not found for ${abi}. ` +
      'Install @frostfast/native, or point FROSTFAST_NATIVE_PATH / ' +
      'FROSTFAST_NATIVE_DIR at a built frostfast.' +
      abi +
      '.node.\nAttempts:\n' +
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
  binding.registerWorkerScheduler(create, terminate)
  workerSchedulerRegistered = true
  return true
}

/** Test-only: clear the scheduler registration latch. */
export function resetWorkerSchedulerForTests(): void {
  workerSchedulerRegistered = false
}
