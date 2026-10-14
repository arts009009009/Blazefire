/**
 * Blazefire next.config plugin
 *
 * Activates Blazefire branding for any Next.js project with a single line:
 *
 *   // next.config.js
 *   const blazefire = require('blazefire/plugin')
 *   module.exports = blazefire({ /* options *\/ })
 *
 * Or, when the project already has a config it cares about, wrap it:
 *
 *   // next.config.ts
 *   export default blazefire(nextConfig)
 *
 * Wrapping merges instead of replaces, so an existing `headers()`,
 * `rewrites()`, `turbopack.root` and friends all survive.
 *
 * All branding content lives in this package. Nothing in the user's project
 * is modified, and node_modules is never patched.
 */

'use strict'

const path = require('path')
const { BLAZEFIRE_BRANDING } = require('./branding.cjs')

const DEFAULTS = {
  // Branding toggles
  theme: true, // inject cyberpunk/OLED CSS into the document
  headers: true, // X-Powered-By / X-Compiler
  overlay: true, // rebrand the dev overlay (best effort)
  poweredBy: 'Blazefire Framework',
  compiler: 'Frostfast v1.0.0',
  version: 'v1.0.0',
}

/**
 * Activate Blazefire branding.
 *
 * Three call shapes:
 *
 *   blazefire(nextConfig)                  // wrap an existing config
 *   blazefire(nextConfig, { theme: false }) // wrap it, override options
 *   blazefire({ theme: false })            // no existing config to wrap
 *
 * The first argument is treated as an existing Next config only when it
 * actually looks like one. That matters: real projects already define
 * `headers()`, `rewrites()` and `turbopack{}`, and returning our config
 * *instead* of theirs would silently delete their security headers and
 * turbopack root. Everything they wrote is preserved and ours is merged in.
 *
 * @param {Partial<typeof DEFAULTS> | import('next').NextConfig} [first]
 * @param {Partial<typeof DEFAULTS>} [second]
 * @returns {import('next').NextConfig}
 */
function blazefire(first = {}, second) {
  // Update check: fire-and-forget, dev-only, at most once per 24h. Must never
  // gate or throw here — this runs inside next.config evaluation.
  try {
    require('./update-check.cjs').maybeNotify()
  } catch (_) {
    /* a missing notifier must never break the config */
  }

  // Next's config export may itself be a function — sync or async:
  //   module.exports = (phase, { defaultConfig }) => ({ ... })
  // It has to be handled before the object path below, because a function has
  // no own enumerable keys: `isNextConfig(fn)` is false and `{...fn}` is `{}`,
  // which would silently REPLACE the user's whole config with ours.
  // Next resolves it via normalizeConfig(), which calls it with
  // (phase, { defaultConfig }) and awaits the result — so returning an async
  // wrapper here is safe.
  if (typeof first === 'function') {
    const userConfig = first
    const ours = buildConfig({ ...DEFAULTS, ...(second || {}) })
    return async function blazefireWrappedConfig(phase, ctx) {
      const base = await userConfig(phase, ctx)
      return mergeConfigs(base && typeof base === 'object' ? base : {}, ours)
    }
  }

  const baseIsConfig = isNextConfig(first)
  // Our own options can arrive as the whole argument, or mixed into a config
  // (`blazefire({ trailingSlash: true, theme: false })`). Pull them out so
  // neither intent is lost; `second` is always the options bag and wins.
  const options = {
    ...DEFAULTS,
    ...(baseIsConfig ? pickOptions(first) : first),
    ...(second || {}),
  }
  const base = baseIsConfig ? omitOptions(first) : {}

  return mergeConfigs(base, buildConfig(options))
}

/**
 * @param {Partial<typeof DEFAULTS>} opts
 * @returns {import('next').NextConfig}
 */
function buildConfig(opts) {
  return {
    // Next sets `X-Powered-By: Next.js` unconditionally in sendRenderResult()
    // AFTER custom headers() are applied, which would clobber ours. Disabling
    // it lets the headers() entry below stand on its own.
    poweredByHeader: false,

    // ---- 1. HTTP identity (works on webpack AND turbopack) ----
    ...(opts.headers && {
      headers: async () => [
        {
          source: '/:path*',
          headers: [
            { key: 'X-Powered-By', value: opts.poweredBy },
            { key: 'X-Compiler', value: opts.compiler },
          ],
        },
      ],
    }),

    // ---- 2. Build-time flag so runtime code can detect Blazefire ----
    env: {
      NEXT_PUBLIC_BLAZEFIRE: 'true',
      NEXT_PUBLIC_BLAZEFIRE_VERSION: opts.version,
      NEXT_PUBLIC_BLAZEFIRE_COMPILER: 'frostfast',
    },

    // ---- 3. Client-side theme injection (webpack builds) ----
    //
    // Next hands this hook `entry` as an async function (webpack-config.ts
    // builds it that way) and only resolves it *after* the hook returns, so
    // treating it as an object iterates nothing and injects silently. Wrap it
    // instead, and PREPEND our runtime to every entry that comes back:
    // prepending keeps Next's client bootstrap — assigning over an entry would
    // delete the app — and running first is what lets the theme register
    // before application code.
    webpack(config, ctx) {
      if (!opts.theme || !config || typeof config !== 'object') return config
      if (ctx && ctx.isServer) return config

      const runtime = path.join(__dirname, 'runtime', 'inject.cjs')

      if (typeof config.entry === 'function') {
        const originalEntry = config.entry
        config.entry = function (...args) {
          return Promise.resolve(originalEntry.apply(this, args)).then(
            (entry) => prependRuntimeToEntries(entry, runtime)
          )
        }
      } else if (config.entry) {
        config.entry = prependRuntimeToEntries(config.entry, runtime)
      }
      return config
    },

    // ---- 4. Turbopack: config schema has no `entry` key (it is a
    //         strictObject of rules/resolveAlias/resolveExtensions/root/
    //         debugIds/ignoreIssue/chunkLoadingGlobal only), and Next
    //         specifies its client entry as a relative filesystem path, so
    //         resolveAlias never matches. `rules` matches by path glob and
    //         accepts webpack loaders — that's our injection vector. ----
    turbopack: {
      rules: buildTurbopackRules(opts),
    },
  }
}

/**
 * Our own option names and the value type each one must have.
 *
 * Type-aware on purpose: `headers` is a boolean for us but a function (or
 * array) for Next, and `compiler` is a version string for us but an object for
 * Next — so the *value* is what tells the two apart, not the key.
 */
const OPTION_TYPES = {
  theme: 'boolean',
  headers: 'boolean',
  overlay: 'boolean',
  poweredBy: 'string',
  compiler: 'string',
  version: 'string',
}

/**
 * @param {string} key
 * @param {unknown} value
 * @returns {boolean}
 */
function isOurOption(key, value) {
  const expected = OPTION_TYPES[key]
  return expected !== undefined && typeof value === expected
}

/**
 * @param {unknown} x
 * @returns {Record<string, unknown>}
 */
function pickOptions(x) {
  if (!x || typeof x !== 'object') return {}
  const out = {}
  for (const key of Object.keys(x)) {
    if (isOurOption(key, /** @type {any} */ (x)[key]))
      out[key] = /** @type {any} */ (x)[key]
  }
  return out
}

/**
 * @param {unknown} x
 * @returns {Record<string, unknown>}
 */
function omitOptions(x) {
  if (!x || typeof x !== 'object') return {}
  const out = {}
  for (const key of Object.keys(x)) {
    if (!isOurOption(key, /** @type {any} */ (x)[key]))
      out[key] = /** @type {any} */ (x)[key]
  }
  return out
}

/**
 * Is this argument an existing Next config rather than our own options bag?
 *
 * Decided by exclusion rather than by a fixed allow-list of Next keys. An
 * allow-list can never be complete — `trailingSlash`, `distDir`, `pageExtensions`,
 * `i18n`, `compress`, `logging`, `swcMinify` and friends were all missing, so a
 * perfectly ordinary config written with them was classified as options and its
 * entire contents were thrown away. Anything carrying a key/value we do not own
 * is a config; a bag made up purely of our options is not.
 *
 * @param {unknown} x
 * @returns {boolean}
 */
function isNextConfig(x) {
  if (!x || typeof x !== 'object') return false

  return Object.keys(x).some(
    (key) => !isOurOption(key, /** @type {any} */ (x)[key])
  )
}

/**
 * Merge our branding into a config the project already wrote.
 *
 * Rules, in priority order:
 *  - scalars: ours wins, EXCEPT nothing can opt back into Next's
 *    `X-Powered-By: Next.js`, which is stamped after headers() and would
 *    overwrite ours;
 *  - `headers()` / `redirects()` style arrays: concatenate, never replace;
 *  - `turbopack`: shallow-merge so their `root`/`resolveAlias` survive
 *    alongside our `rules`;
 *  - `webpack`: chain, so their transforms still run;
 *  - everything else (rewrites, images, experimental...): untouched.
 *
 * @param {import('next').NextConfig} base
 * @param {import('next').NextConfig} ours
 * @returns {import('next').NextConfig}
 */
function mergeConfigs(base, ours) {
  if (!base || Object.keys(base).length === 0) return ours

  const out = { ...base, ...ours }

  // Our env vars layer on top of theirs rather than replacing them.
  out.env = { ...(base.env || {}), ...(ours.env || {}) }

  // Both sets of headers must reach the wire.
  if (base.headers || ours.headers) {
    out.headers = concatListProviders(base.headers, ours.headers)
  }

  // Shallow-merge so `turbopack.root` (etc.) survives; only `rules` needs a
  // deeper merge because both sides may define globs.
  if (base.turbopack || ours.turbopack) {
    out.turbopack = {
      ...(base.turbopack || {}),
      ...(ours.turbopack || {}),
      rules: {
        ...((base.turbopack && base.turbopack.rules) || {}),
        ...((ours.turbopack && ours.turbopack.rules) || {}),
      },
    }
  }

  // Chain webpack hooks — theirs runs first, ours prepends the entry last so
  // the branding entry sits in front of application code.
  if (base.webpack && ours.webpack) {
    const oursWebpack = ours.webpack
    out.webpack = (config, ctx) => {
      const afterBase = base.webpack(config, ctx)
      // A hook that returns nothing — or a Promise, which Next only warns
      // about — is not a webpack config. Hand ours the config we were given
      // rather than letting it read `.entry` off something unusable.
      const usable =
        afterBase &&
        typeof afterBase === 'object' &&
        typeof afterBase.then !== 'function'
      return oursWebpack(usable ? afterBase : config, ctx)
    }
  }

  return out
}

/**
 * Combine two `headers()`-style providers (either an array or a function
 * returning one) into a single provider yielding both lists.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {unknown}
 */
function concatListProviders(a, b) {
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

/**
 * Prepend the Blazefire runtime to every entry in a resolved webpack
 * `EntryObject`, leaving the entries' own contents intact.
 *
 * Handles the three shapes webpack accepts: a string, an array of strings,
 * and an entry descriptor (`{ import: [...] }`). Unknown shapes are returned
 * untouched rather than corrupted, and an entry already carrying the runtime
 * is left alone so repeated config evaluation stays idempotent.
 *
 * @param {unknown} entry
 * @param {string} runtime
 * @returns {unknown}
 */
function prependRuntimeToEntries(entry, runtime) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry

  const out = {}
  for (const name of Object.keys(entry)) {
    out[name] = prependRuntimeToValue(entry[name], runtime)
  }
  return out
}

/**
 * @param {unknown} value
 * @param {string} runtime
 * @returns {unknown}
 */
function prependRuntimeToValue(value, runtime) {
  if (typeof value === 'string') {
    return value === runtime ? [value] : [runtime, value]
  }
  if (Array.isArray(value)) {
    return value.includes(runtime) ? value : [runtime, ...value]
  }
  if (
    value &&
    typeof value === 'object' &&
    Array.isArray(/** @type {any} */ (value).import)
  ) {
    const descriptor = /** @type {{import: string[]}} */ (value)
    return descriptor.import.includes(runtime)
      ? value
      : { ...descriptor, import: [runtime, ...descriptor.import] }
  }
  return value
}

/**
 * Prepends a side-effect import of the Blazefire runtime to Next's client
 * bootstrap so the theme is registered before any application code runs.
 *
 * Matches the bootstrap by glob rather than by import specifier because
 * Next passes it as `./next/dist/client/app-next.js` (a relative path from
 * the project root), which alias keys never match.
 *
 * @param {object} opts
 * @returns {Record<string, Array<{loader: string, options: object}>>}
 */
function buildTurbopackRules(opts) {
  if (!opts.theme) return {}

  const loader = path.join(__dirname, 'runtime', 'turbopack-loader.cjs')
  const inject = path.join(__dirname, 'runtime', 'inject.cjs')

  // Covers dev (next-dev.js / app-next-dev.js) and prod (next.js / app-next.js)
  // across both the pages and app routers. Turbopack globs are matched against
  // absolute paths, hence the `**/` prefix.
  const targets = [
    '**/next/dist/client/app-next*.js',
    '**/next/dist/client/next*.js',
  ]

  const rules = {}
  for (const glob of targets) {
    rules[glob] = [{ loader, options: { injectPath: inject } }]
  }
  return rules
}

module.exports = blazefire
module.exports.blazefire = blazefire
module.exports.branding = BLAZEFIRE_BRANDING
module.exports.DEFAULTS = DEFAULTS
module.exports.isNextConfig = isNextConfig
module.exports.mergeConfigs = mergeConfigs
module.exports.prependRuntimeToEntries = prependRuntimeToEntries
