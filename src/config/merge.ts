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

import {
  BlazefireConfigError,
  type ListProvider,
  type NextConfigLike,
  type HeaderRule,
  type TurbopackRule,
} from './types.js'

export function mergeConfigs(base: NextConfigLike, ours: NextConfigLike): NextConfigLike {
  if (!base || Object.keys(base).length === 0) return ours

  if ('webpack' in base) {
    throw new BlazefireConfigError(
      'Blazefire v2 is Turbopack-only: the `webpack()` config hook is not supported. ' +
        'Remove it from your config (or migrate its transform to `turbopack.rules`).'
    )
  }

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
    out.turbopack = {
      ...(base.turbopack || {}),
      ...(ours.turbopack || {}),
      rules: {
        ...(base.turbopack?.rules || {}),
        ...(ours.turbopack?.rules || {}),
      } as Record<string, TurbopackRule[]>,
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
