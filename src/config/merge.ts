/**
 * mergeConfigs — wrap, never replace (v1 semantics preserved, minus webpack).
 *
 * Rules, in priority order:
 *  - a `webpack` hook in the project config is a HARD ERROR: v2 is a pure
 *    Turbopack/Frostfast framework (spec H-01); silently preserving a hook
 *    that can never run would be a lie.
 *  - scalars: ours wins, except nothing can opt back into the host
 *    framework's own X-Powered-By, which it stamps after headers().
 *  - headers()/redirects()-style lists: concatenate, never replace.
 *  - turbopack: shallow-merge so `root`/`resolveAlias` survive; `rules`
 *    deep-merges because both sides may define globs.
 *  - everything else (rewrites, images, experimental…): untouched.
 */

import { defineOwn } from './serialize.js'
import {
  BlazefireConfigError,
  type ListProvider,
  type NextConfigLike,
  type HeaderRule,
  type TurbopackRule,
} from './types.js'

/**
 * Refuse a real `webpack()` hook. Reads through the prototype chain (property
 * access, not Object.keys) so a class-based config cannot evade it, and runs
 * BEFORE any empty-object shortcut — `webpack: undefined` (the conditional
 * idiom) and inherited hooks behave exactly as the H-01 contract requires.
 */
export function assertNoWebpack(config: unknown): void {
  if (config && typeof (config as { webpack?: unknown }).webpack === 'function') {
    throw new BlazefireConfigError(
      'Blazefire v2 is Turbopack-only: the `webpack()` config hook is not supported. ' +
        'Remove it from your config (or migrate its transform to `turbopack.rules`).'
    )
  }
}

export function mergeConfigs(base: NextConfigLike, ours: NextConfigLike): NextConfigLike {
  // The webpack check runs BEFORE the empty-base shortcut: a class-based
  // config can carry `webpack` on its prototype with zero own keys, and
  // returning early would let the hard error (spec H-01) slip past.
  assertNoWebpack(base)

  if (!base || Object.keys(base).length === 0) return ours

  const out: NextConfigLike = { ...base, ...ours }

  // Our env layers on top of theirs rather than replacing it.
  out.env = { ...(base.env || {}), ...(ours.env || {}) }

  // Both header lists must reach the wire.
  if (base.headers || ours.headers) {
    out.headers = concatListProviders(base.headers, ours.headers) as NextConfigLike['headers']
  }

  if (base.redirects || ours.redirects) {
    out.redirects = concatListProviders(
      base.redirects,
      ours.redirects
    ) as NextConfigLike['redirects']
  }

  // Shallow-merge so `turbopack.root` (etc.) survives; only `rules` needs a
  // deeper merge because both sides may define globs.
  if (base.turbopack || ours.turbopack) {
    const rules = { ...(base.turbopack?.rules || {}) }
    for (const [glob, oursRules] of Object.entries(ours.turbopack?.rules || {})) {
      // defineProperty, not `=`: a glob literally named `__proto__` would
      // otherwise hit Object.prototype's setter and swap the object's
      // prototype instead of adding a rule.
      const existing = Object.prototype.hasOwnProperty.call(rules, glob)
        ? rules[glob]
        : undefined
      defineOwn(rules, glob, [...(existing || []), ...oursRules])
    }

    out.turbopack = {
      ...(base.turbopack || {}),
      ...(ours.turbopack || {}),
      rules: rules as Record<string, TurbopackRule[]>,
    }
  }

  return out
}

/** Combine two list providers into one yielding both lists. */
function concatListProviders<T>(a: ListProvider<T> | undefined, b: ListProvider<T> | undefined) {
  if (!a) return b
  if (!b) return a

  return async () => {
    const [x, y] = await Promise.all([
      typeof a === 'function' ? a() : a,
      typeof b === 'function' ? b() : b,
    ])
    return [...(Array.isArray(x) ? x : []), ...(Array.isArray(y) ? y : [])]
  }
}

export type { HeaderRule }
