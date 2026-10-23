/**
 * blazefire() — the next.config wrapper.
 *
 *   // next.config.ts
 *   export default blazefire(nextConfig)
 *
 * Wrapping MERGES instead of replaces, so an existing headers(), redirects(),
 * turbopack.root and friends all survive. v2 differences from v1:
 *
 *  - NO webpack() hook (spec H-01): injection happens exclusively through
 *    turbopack.rules -> runtime/turbopack-loader.js
 *  - NO update-check on config evaluation (spec H-16): nothing in this
 *    package phones home during a build
 *  - NO postinstall host mutation (spec H-17): activation is explicit
 *    (see cli.ts)
 */

import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BLAZEFIRE_BRANDING } from './branding.js'
import { DEFAULTS, isNextConfig, omitOptions, pickOptions } from './config/options.js'
import { mergeConfigs } from './config/merge.js'
import type { BlazefireOptions, NextConfigLike, TurbopackRules } from './config/types.js'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Both halves of the client runtime travel through ONE injected file, which
 * cannot see this config object — so each toggle is published as an
 * inlined NEXT_PUBLIC_* value (static member reads in the runtime).
 */
export function buildConfig(opts: BlazefireOptions): NextConfigLike {
  const applyTheme = opts.theme !== false
  const applyOverlay = opts.overlay !== false
  const applyHeaders = opts.headers !== false
  const injectRuntime = applyTheme || applyOverlay

  return {
    // The host framework stamps its own X-Powered-By AFTER headers() run;
    // disabling it lets ours stand. Only when we emit our own headers —
    // opting out of Blazefire's must not opt out of the framework's.
    ...(applyHeaders && { poweredByHeader: false }),

    ...(applyHeaders && {
      headers: async () => [
        {
          source: '/:path*',
          headers: [
            { key: 'X-Powered-By', value: opts.poweredBy ?? BLAZEFIRE_BRANDING.headers.poweredBy },
            { key: 'X-Compiler', value: opts.compiler ?? BLAZEFIRE_BRANDING.headers.compiler },
          ],
        },
      ],
    }),

    env: {
      NEXT_PUBLIC_BLAZEFIRE: 'true',
      NEXT_PUBLIC_BLAZEFIRE_VERSION: opts.version ?? `v${BLAZEFIRE_BRANDING.version}`,
      NEXT_PUBLIC_BLAZEFIRE_COMPILER: 'frostfast',
      NEXT_PUBLIC_BLAZEFIRE_THEME: applyTheme ? 'true' : 'false',
      NEXT_PUBLIC_BLAZEFIRE_OVERLAY: applyOverlay ? 'true' : 'false',
    },

    turbopack: {
      rules: buildTurbopackRules(injectRuntime),
    },
  }
}

/**
 * The single injection vector: match the host framework's client bootstrap
 * by path glob (its entry is a relative filesystem path, which resolveAlias
 * can never match) and prepend the runtime import via a loader.
 */
export function buildTurbopackRules(injectRuntime: boolean): TurbopackRules {
  if (!injectRuntime) return {}

  const loader = join(packageRoot, 'dist', 'runtime', 'turbopack-loader.js')
  const targets = [
    '**/next/dist/client/app-next*.js',
    '**/next/dist/client/next*.js',
  ]

  const rules: TurbopackRules = {}
  for (const glob of targets) {
    rules[glob] = [{ loader }]
  }
  return rules
}

/**
 * Three call shapes (v1 semantics preserved):
 *
 *   blazefire(nextConfig)                   // wrap an existing config
 *   blazefire(nextConfig, { theme: false }) // wrap + override options
 *   blazefire({ theme: false })             // no existing config
 */
export function blazefire(
  first: NextConfigLike | BlazefireOptions | ((phase: string, ctx: unknown) => NextConfigLike | Promise<NextConfigLike>) = {},
  second?: BlazefireOptions
): NextConfigLike | ((phase: string, ctx: unknown) => Promise<NextConfigLike>) {
  // The config export may be a function (sync or async). Handle it first:
  // a function has no own enumerable keys, so the object path would silently
  // REPLACE the user's whole config with ours.
  if (typeof first === 'function') {
    const userConfig = first
    const ours = buildConfig({ ...DEFAULTS, ...(second ?? {}) })
    return async function blazefireWrappedConfig(phase, ctx) {
      const base = await userConfig(phase, ctx)
      return mergeConfigs(base && typeof base === 'object' ? base : {}, ours)
    }
  }

  const baseIsConfig = isNextConfig(first)
  // Options can arrive as the whole argument or mixed into a config
  // (`blazefire({ trailingSlash: true, theme: false })`); pull them out so
  // neither intent is lost. `second` is always the options bag and wins.
  const options: BlazefireOptions = {
    ...DEFAULTS,
    ...(baseIsConfig ? pickOptions(first) : (first as BlazefireOptions)),
    ...(second ?? {}),
  }
  const base = baseIsConfig ? omitOptions(first) : {}

  return mergeConfigs(base, buildConfig(options))
}

export default blazefire
