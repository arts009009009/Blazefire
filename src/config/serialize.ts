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
 *    normalized — same normalization set as v1, minus the waste,
 *  - RegExp/Date/Map/Set are decomposed deterministically so two
 *    semantically different configs can never collide onto the same hash
 *    (a RegExp field used to collapse to `{}` and silently swallow edits).
 */

import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { BlazefireConfigError } from './types.js'

/**
 * Own-property write that bypasses the `__proto__` setter on Object.prototype.
 * Plain `obj[key] = value` with key `__proto__` swaps the object's prototype
 * instead of adding a key, so the value would silently vanish from what
 * crosses into Rust (or corrupt a merged rules map).
 */
export function defineOwn<T>(target: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  })
}

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

/**
 * Deterministic key order for anything that reaches the hash (H-08).
 * JSON.stringify preserves insertion order, so two content-equal configs with
 * different key order would hash differently — the change gate would fire for
 * nothing, and a persistent cache key built from `process.env` iteration
 * (whose order is not stable across machines) would never be stable. Compare
 * in UTF-16 code-unit order — NOT localeCompare, which is locale-dependent
 * and would make the hash machine-dependent again. Arrays/Sets are NEVER
 * sorted: their order is semantic (defineEnv arrays, rule arrays).
 */
function sortedByKey<T>(entries: Array<[string, T]>): Array<[string, T]> {
  return entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
}

/** env crosses as flat [{name, value}] tuples — never recursive marshalling. */
export interface RustifiedEnvVar {
  name: string
  value: string | undefined
}

export function rustifyEnv(env: Record<string, string | undefined>): RustifiedEnvVar[] {
  // Sorted by name (why: sortedByKey above) — env is usually built by
  // iterating `process.env`, whose order differs between machines/runs.
  return sortedByKey(Object.entries(env)).map(([name, value]) => ({ name, value }))
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

/**
 * Rewrite the two number literals JSON silently changes (-0 → `0`,
 * NaN → `null`) onto their own round-trip form, recursively, so the guard
 * below can compare the original against `JSON.parse(JSON.stringify(...))`
 * without those serializable number LITERALS false-positiving as
 * "not JSON-serializable". EVERYTHING else is passed through untouched:
 *
 *  - function/symbol VALUES and undefined-valued keys survive here, so the
 *    round-trip still drops them and the deep-equal check still throws;
 *  - only PLAIN objects are rebuilt — Date/Map/Set/RegExp/class instances
 *    are kept as-is (their prototypes already fail isDeepStrictEqual against
 *    the parsed round-trip, exactly as before);
 *  - enumerable symbol KEYS are re-declared: JSON drops them from `round`,
 *    and re-declaring keeps them visible to the comparison (they threw
 *    before, they throw after). They cannot go through defineOwn (string
 *    keys only), hence defineProperty;
 *  - no cycle guard: a cycle overflows the recursion, and the RangeError is
 *    caught by the same `catch` that handles JSON.stringify's
 *    circular-structure TypeError — same actionable error either way.
 */
function canonicalizeJsonNumbers(value: unknown): unknown {
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return null
    if (Object.is(value, -0)) return 0
    return value
  }
  if (Array.isArray(value)) return value.map((entry) => canonicalizeJsonNumbers(entry))
  if (value !== null && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) return value // non-plain: compare as-is
    const rec = value as Record<string | symbol, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(rec)) {
      defineOwn(out, key, canonicalizeJsonNumbers(rec[key]))
    }
    for (const key of Object.getOwnPropertySymbols(rec)) {
      if (Object.prototype.propertyIsEnumerable.call(rec, key)) {
        Object.defineProperty(out, key, {
          value: canonicalizeJsonNumbers(rec[key]),
          enumerable: true,
          writable: true,
          configurable: true,
        })
      }
    }
    return out
  }
  return value // string/boolean/null/bigint/function/symbol — JSON semantics untouched
}

/** Zero/normalize the fields the Rust side can never read (functions, FS paths). */
function normalizeNextConfig(nextConfig: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...nextConfig }

  // Never read by Rust; functions are not serializable. Guard on the VALUE so
  // `exportPathMap: undefined` (or a legitimate non-function value) is not
  // clobbered — matching the generateBuildId/webpack checks below.
  if (typeof out.exportPathMap === 'function') out.exportPathMap = {}
  if (typeof out.generateBuildId === 'function') out.generateBuildId = {}
  if (typeof out.webpack === 'function') out.webpack = {}

  if (typeof out.distDir === 'string') {
    out.distDir = normalizePathOnWindows(out.distDir)
  }

  // Loader options must round-trip through JSON identically or the Rust side
  // rejects them at project construction (v1 serializability guard, kept —
  // deep-equality catches functions, Dates, Maps, dropped undefined keys).
  // The original is canonicalized through JSON's number semantics first:
  // JSON cannot represent -0 or NaN (it writes `0`/`null`), so those two
  // serializable number literals would otherwise be rejected by their OWN
  // round-trip — `{ retryDelay: -0 }` is not "not JSON-serializable".
  // canonicalizeJsonNumbers rewrites nothing else, so genuinely-lossy values
  // still mismatch the round-trip below and throw, as they always did.
  const turbopack = out.turbopack as
    | { rules?: Record<string, Array<{ options?: unknown }>> }
    | undefined
  for (const [glob, rules] of Object.entries(turbopack?.rules ?? {})) {
    for (const rule of rules) {
      if (rule.options === undefined) continue
      let canonical: unknown
      let round: unknown
      try {
        canonical = canonicalizeJsonNumbers(rule.options)
        round = JSON.parse(JSON.stringify(canonical))
      } catch {
        // A function/BigInt/symbol/circular options value: the recursion
        // overflows, or JSON.stringify throws or yields `undefined`. Report
        // the ACTIONABLE error, not a cryptic SyntaxError about the token `u`.
        throw new BlazefireConfigError(
          `turbopack.rules["${glob}"] loader options are not JSON-serializable`
        )
      }
      if (!isDeepStrictEqual(canonical, round)) {
        throw new BlazefireConfigError(
          `turbopack.rules["${glob}"] loader options are not JSON-serializable`
        )
      }
    }
  }

  return out
}

/**
 * Deterministic wire transform for `nextConfig`.
 *
 * RegExp/Date/Map/Set are decomposed into JSON-safe shapes so two different
 * configs never collapse onto the same string (and therefore never onto the
 * same sha256). Functions/symbols are dropped exactly as JSON.stringify would.
 * BigInt and circular references raise an actionable BlazefireConfigError
 * instead of a raw TypeError from deep inside JSON.stringify.
 */
function toWire(value: unknown, path: string, seen: Set<object>): unknown {
  if (value === null) return null

  switch (typeof value) {
    case 'function':
    case 'symbol':
      return undefined // dropped, same as JSON.stringify
    case 'bigint':
      throw new BlazefireConfigError(
        `nextConfig.${path} is a BigInt, which cannot cross the napi boundary. Convert it to a string or number.`
      )
    case 'object':
      break
    default:
      return value // primitives
  }

  const obj = value as object

  // Decompositions — the documented wire conventions.
  if (obj instanceof RegExp) {
    return { type: 'regex', value: { source: obj.source, flags: obj.flags } }
  }
  if (obj instanceof Date) {
    return Number.isNaN(obj.getTime())
      ? null
      : obj.toISOString()
  }

  if (seen.has(obj)) {
    throw new BlazefireConfigError(
      `nextConfig.${path} contains a circular reference, which cannot cross the napi boundary.`
    )
  }
  seen.add(obj)
  try {
    if (Array.isArray(obj)) {
      return obj.map((entry, i) => toWire(entry, `${path}[${i}]`, seen))
    }
    if (obj instanceof Map) {
      const out: Record<string, unknown> = {}
      for (const [k, v] of obj) defineOwn(out, String(k), toWire(v, path, seen))
      return out
    }
    if (obj instanceof Set) {
      return [...obj].map((entry, i) => toWire(entry, `${path}.set[${i}]`, seen))
    }

    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      const wired = toWire(v, `${path}.${k}`, seen)
      if (wired !== undefined) defineOwn(out, k, wired)
    }
    return out
  } finally {
    seen.delete(obj)
  }
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
    nextConfig: toWire(
      normalizeNextConfig(config.nextConfig),
      'nextConfig',
      new Set<object>()
    ),
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
