/**
 * Project-config serialization across the napi boundary (spec H-08 fix).
 *
 * v1 re-serialized the full nextConfig with JSON.stringify(config, null, 2)
 * on EVERY createProject and every env/tsconfig update: pretty-printing
 * doubled a multi-KB string for no consumer (the Rust side parses it), and
 * unchanged configs were re-sent wholesale.
 *
 * v2:
 *  - compact serialization only (no indent bytes),
 *  - a content hash computed alongside, so project.update() can SKIP the
 *    send entirely when the config did not actually change,
 *  - functions zeroed (they cannot cross the boundary), Windows paths
 *    normalized — same normalization set as v1, minus the waste.
 */

import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

/** Decomposition of a RegExp — regexes cannot cross napi natively (v1 convention, kept). */
export type SerializedPattern =
  | { type: 'regex'; value: { source: string; flags: string } }
  | { type: 'glob'; value: string }
  | { type: 'constant'; value: string }

export function serializePattern(p: string | RegExp): SerializedPattern {
  if (p instanceof RegExp) {
    return { type: 'regex', value: { source: p.source, flags: p.flags } }
  }
  return { type: 'glob', value: p }
}

/** env crosses as flat [{name, value}] tuples — never recursive marshalling. */
export interface RustifiedEnvVar {
  name: string
  value: string | undefined
}

export function rustifyEnv(env: Record<string, string | undefined>): RustifiedEnvVar[] {
  return Object.entries(env).map(([name, value]) => ({ name, value }))
}

/** The JS-side view of the config fields that cross into the Rust project graph. */
export interface SerializableProjectConfig {
  rootPath: string
  projectPath: string
  distDir: string
  dev: boolean
  buildId: string
  env: Record<string, string | undefined>
  /** Already rustified per-variant define env. */
  defineEnv: Record<string, RustifiedEnvVar[]>
  /** The raw user config; normalized + compactly serialized here. */
  nextConfig: Record<string, unknown>
}

export interface SerializedProjectConfig {
  /** Compact JSON — the ONE string NapiProjectOptions.nextConfig carries. */
  json: string
  /** sha256 of `json`; the change gate keys on this. */
  hash: string
}

function normalizePathOnWindows(p: string): string {
  return p.replace(/\\/g, '/')
}

/** Zero/normalize the fields the Rust side can never read (functions, FS paths). */
function normalizeNextConfig(nextConfig: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...nextConfig }

  // Never read by Rust; functions are not serializable.
  if ('exportPathMap' in out) out.exportPathMap = {}
  if (typeof out.generateBuildId === 'function') out.generateBuildId = {}
  if (typeof out.webpack === 'function') out.webpack = {}

  if (typeof out.distDir === 'string') {
    out.distDir = normalizePathOnWindows(out.distDir)
  }

  // Loader options must round-trip through JSON identically or the Rust side
  // rejects them at project construction (v1 serializability guard, kept —
  // deep-equality catches functions, Dates, Maps, dropped undefined keys).
  const turbopack = out.turbopack as
    | { rules?: Record<string, Array<{ options?: unknown }>> }
    | undefined
  for (const [glob, rules] of Object.entries(turbopack?.rules ?? {})) {
    for (const rule of rules) {
      if (rule.options === undefined) continue
      const round = JSON.parse(JSON.stringify(rule.options))
      if (!isDeepStrictEqual(rule.options, round)) {
        throw new Error(
          `turbopack.rules["${glob}"] loader options are not JSON-serializable`
        )
      }
    }
  }

  return out
}

export function serializeProjectConfig(
  config: SerializableProjectConfig
): SerializedProjectConfig {
  // Compact on purpose: the Rust side JSON.parses this; indent bytes are
  // pure waste on a string that crosses the boundary on every update.
  const json = JSON.stringify({
    rootPath: normalizePathOnWindows(config.rootPath),
    projectPath: normalizePathOnWindows(config.projectPath),
    distDir: normalizePathOnWindows(config.distDir),
    dev: config.dev,
    buildId: config.buildId,
    env: rustifyEnv(config.env),
    defineEnv: config.defineEnv,
    nextConfig: normalizeNextConfig(config.nextConfig),
  })
  const hash = createHash('sha256').update(json).digest('hex')
  return { json, hash }
}

/**
 * Change gate: remembers the last hash sent to Rust so unchanged configs are
 * never re-marshalled. `project.update()` consults this before crossing the
 * boundary (see compiler/project.ts).
 */
export class ConfigChangeGate {
  #lastHash: string | undefined

  /** True when `next` differs from the last remembered snapshot. */
  changed(next: SerializedProjectConfig): boolean {
    return next.hash !== this.#lastHash
  }

  remember(snapshot: SerializedProjectConfig): void {
    this.#lastHash = snapshot.hash
  }

  reset(): void {
    this.#lastHash = undefined
  }
}
