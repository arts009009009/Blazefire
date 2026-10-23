/**
 * Option recognition for the blazefire() wrapper.
 *
 * `headers` is a boolean for us but a function/array for the host framework,
 * and `compiler` is a version string for us but an object there — so the
 * VALUE type, not the key, tells the two apart.
 */

import { BLAZEFIRE_BRANDING } from '../branding.js'
import type { BlazefireOptions } from './types.js'

export const DEFAULTS: BlazefireOptions = {
  theme: true,
  headers: true,
  overlay: true,
  // Derived from the single source of truth so header values can never drift
  // from the version actually installed.
  poweredBy: BLAZEFIRE_BRANDING.headers.poweredBy,
  compiler: BLAZEFIRE_BRANDING.headers.compiler,
  version: `v${BLAZEFIRE_BRANDING.version}`,
}

const OPTION_TYPES: Record<keyof BlazefireOptions, string> = {
  theme: 'boolean',
  headers: 'boolean',
  overlay: 'boolean',
  poweredBy: 'string',
  compiler: 'string',
  version: 'string',
}

export function isOurOption(key: string, value: unknown): boolean {
  const expected = OPTION_TYPES[key as keyof BlazefireOptions]
  return expected !== undefined && typeof value === expected
}

export function pickOptions(x: unknown): BlazefireOptions {
  if (!x || typeof x !== 'object') return {}
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(x)) {
    if (isOurOption(key, (x as Record<string, unknown>)[key])) {
      out[key] = (x as Record<string, unknown>)[key]
    }
  }
  return out as BlazefireOptions
}

export function omitOptions(x: unknown): Record<string, unknown> {
  if (!x || typeof x !== 'object') return {}
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(x)) {
    if (!isOurOption(key, (x as Record<string, unknown>)[key])) {
      out[key] = (x as Record<string, unknown>)[key]
    }
  }
  return out
}

/**
 * Is this argument an existing project config rather than our options bag?
 *
 * Decided by EXCLUSION, not an allow-list: an allow-list can never be
 * complete, and v1 lost whole configs (`trailingSlash`, `distDir`, `i18n`…)
 * to one. Anything carrying a key/value we do not own is a config.
 */
export function isNextConfig(x: unknown): boolean {
  if (!x || typeof x !== 'object') return false
  return Object.keys(x).some(
    (key) => !isOurOption(key, (x as Record<string, unknown>)[key])
  )
}
