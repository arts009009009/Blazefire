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

/**
 * Keys that mean the SAME thing to blazefire and the host framework, so the
 * VALUE type is the only way to tell them apart (`headers` is a boolean for
 * us but a function/array there; `compiler` a version string vs a config
 * object). These stay value-typed.
 */
const DUAL_MEANING_KEYS = new Set(['headers', 'compiler'])

/** Unambiguous boolean toggles we accept a string 'true'/'false' for (env interpolation). */
const BOOLEAN_OPTION_KEYS = new set_(['theme', 'overlay'])

export function isOurOption(key: string, value: unknown): boolean {
  const expected = OPTION_TYPES[key as keyof BlazefireOptions]
  if (expected === undefined) return false
  if (DUAL_MEANING_KEYS.has(key)) return typeof value === expected
  // Unambiguous option NAMES are ours regardless of the value's type, so a
  // mistyped value (e.g. `theme: 'false'` from an env var) can never flip the
  // whole argument's identity and leak a bogus key into the host config.
  return true
}

/** Coerce a string 'true'/'false' into a real boolean for our boolean toggles. */
function coerceOptionValue(key: string, value: unknown): unknown {
  if (
    BOOLEAN_OPTION_KEYS.has(key) &&
    typeof value === 'string' &&
    (value === 'true' || value === 'false')
  ) {
    return value === 'true'
  }
  return value
}

export function pickOptions(x: unknown): BlazefireOptions {
  if (!x || typeof x !== 'object') return {}
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(x)) {
    if (isOurOption(key, (x as Record<string, unknown>)[key])) {
      out[key] = coerceOptionValue(key, (x as Record<string, unknown>)[key])
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
