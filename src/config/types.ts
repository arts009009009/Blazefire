/**
 * Config-layer types.
 *
 * Deliberately decoupled from `next`'s type surface: v2 has no compile-time
 * dependency on the host framework. NextConfigLike is structurally typed so a
 * real NextConfig satisfies it without an import.
 */

export interface BlazefireOptions {
  /** Inject the cyberpunk/OLED document theme. */
  theme?: boolean
  /** Emit X-Powered-By / X-Compiler response headers. */
  headers?: boolean
  /** Rebrand the dev overlay (dev builds only, best effort). */
  overlay?: boolean
  poweredBy?: string
  compiler?: string
  version?: string
}

export interface HeaderEntry {
  key: string
  value: string
}

export interface HeaderRule {
  source: string
  headers: HeaderEntry[]
}

/** headers()/redirects()-style provider: a list or a (possibly async) function returning one. */
export type ListProvider<T> = T[] | (() => T[] | Promise<T[]>)

/** A Turbopack rule entry: a loader with JSON-serializable options. */
export interface TurbopackRule {
  loader: string
  options?: Record<string, unknown>
}

export type TurbopackRules = Record<string, TurbopackRule[]>

export interface TurbopackConfig {
  root?: string
  rules?: TurbopackRules
  resolveAlias?: Record<string, string | string[]>
  resolveExtensions?: string[]
  [key: string]: unknown
}

/**
 * Any Next-compatible config object. Unknown keys pass through untouched —
 * v2 never replaces what the project wrote.
 */
export interface NextConfigLike {
  env?: Record<string, string | undefined>
  headers?: ListProvider<HeaderRule>
  redirects?: ListProvider<HeaderRule>
  turbopack?: TurbopackConfig
  [key: string]: unknown
}

export class BlazefireConfigError extends Error {
  override name = 'BlazefireConfigError'
}
