/**
 * Tests for the `blazefire/plugin` next.config plugin.
 *
 * These run against the CommonJS source (`blazefire/plugin.cjs`), which is
 * exactly what a consumer's `next.config.*` loads.
 */

'use strict'

const path = require('path')
const blazefire = require('../blazefire/plugin.cjs')

const {
  isNextConfig,
  mergeConfigs,
  prependRuntimeToEntries,
  DEFAULTS,
} = blazefire

const INJECT = path.join(__dirname, '..', 'blazefire', 'runtime', 'inject.cjs')

describe('isNextConfig', () => {
  it('treats a pure options bag as options', () => {
    expect(isNextConfig({})).toBe(false)
    expect(isNextConfig({ theme: false })).toBe(false)
    expect(isNextConfig({ theme: false, headers: true, poweredBy: 'x' })).toBe(false)
  })

  it('recognises a config written only with keys we do not own', () => {
    // Regression: an allow-list of Next keys classified this as options, so
    // `{ trailingSlash }` and friends were silently thrown away.
    expect(isNextConfig({ trailingSlash: true })).toBe(true)
    expect(isNextConfig({ distDir: 'build' })).toBe(true)
    expect(isNextConfig({ pageExtensions: ['mdx'] })).toBe(true)
    expect(isNextConfig({ i18n: { locales: ['en'] } })).toBe(true)
    expect(isNextConfig({ transpilePackages: ['ui'] })).toBe(true)
  })

  it('tells our option values apart from Next keys that share the name', () => {
    // `headers` is a boolean for us, a function/array for Next.
    expect(isNextConfig({ headers: () => [] })).toBe(true)
    expect(isNextConfig({ headers: [{ source: '/:path*' }] })).toBe(true)
    // `compiler` is a version string for us, an object for Next.
    expect(isNextConfig({ compiler: { styledComponents: true } })).toBe(true)
    expect(isNextConfig({ compiler: 'Frostfast v1.0.0' })).toBe(false)
  })

  it('recognises classic config shapes', () => {
    expect(isNextConfig({ rewrites: async () => [] })).toBe(true)
    expect(isNextConfig({ redirects: () => [] })).toBe(true)
    expect(isNextConfig({ webpack: () => ({}) })).toBe(true)
    expect(isNextConfig({ turbopack: {} })).toBe(true)
    expect(isNextConfig({ experimental: {} })).toBe(true)
  })
})

describe('blazefire(config)', () => {
  it('keeps a config that only uses keys we do not know', () => {
    const out = blazefire({ trailingSlash: true, distDir: 'build' })
    expect(out.trailingSlash).toBe(true)
    expect(out.distDir).toBe('build')
    // and layers ours on top
    expect(out.poweredByHeader).toBe(false)
    expect(out.env.NEXT_PUBLIC_BLAZEFIRE).toBe('true')
  })

  it('keeps a config and still applies options from the second argument', async () => {
    const out = blazefire({ trailingSlash: true }, { poweredBy: 'Blazefire Test' })
    expect(out.trailingSlash).toBe(true)
    const headers = await awaitValue(out.headers)
    expect(headers.some((h) => h.headers.some((x) => x.value === 'Blazefire Test'))).toBe(true)
  })

  it('honours a lone options bag without inventing config keys', () => {
    const out = blazefire({ theme: false })
    expect(out.trailingSlash).toBeUndefined()
    expect(out.poweredByHeader).toBe(false)
    // theme off → no entry injection at all
    const entry = { 'main': ['./next/dist/client/next.js'] }
    const cfg = { entry }
    out.webpack(cfg, { isServer: false })
    expect(cfg.entry).toBe(entry)
    expect(cfg.entry['main']).toEqual(['./next/dist/client/next.js'])
  })

  it('keeps options and config when both arrive in one object', () => {
    const out = blazefire({ trailingSlash: true, theme: false })
    expect(out.trailingSlash).toBe(true)
    const cfg = { entry: { main: ['./next/dist/client/next.js'] } }
    out.webpack(cfg, { isServer: false })
    expect(cfg.entry['main']).toEqual(['./next/dist/client/next.js'])
  })

  it('applies the options bag even when the first argument is empty', async () => {
    const out = blazefire({}, { poweredBy: 'Second Bag' })
    const headers = await awaitValue(out.headers)
    expect(headers.some((h) => h.headers.some((x) => x.value === 'Second Bag'))).toBe(true)
  })

  it('wraps an existing headers() instead of replacing it', async () => {
    const userHeaders = [{ source: '/api/:path*', headers: [{ key: 'X-Api', value: '1' }] }]
    const out = blazefire({ headers: async () => userHeaders })
    const merged = await awaitValue(out.headers)
    // Both lists reach the wire: the user's own headers survive, ours are added.
    expect(merged).toEqual([...userHeaders, ...await awaitValue(blazefire().headers)])
    expect(merged.some((h) => h.source === '/api/:path*')).toBe(true)
    expect(merged.some((h) => h.source === '/:path*')).toBe(true)
  })

  it('wraps a function-style next.config', async () => {
    const wrapped = blazefire(async () => ({ trailingSlash: true }))
    expect(typeof wrapped).toBe('function')
    const resolved = await wrapped('phase-production-build', {})
    expect(resolved.trailingSlash).toBe(true)
    expect(resolved.env.NEXT_PUBLIC_BLAZEFIRE).toBe('true')
  })
})

describe('webpack entry injection', () => {
  const isServer = false

  it('prepends to an async entry function — the shape Next actually passes', () => {
    // Regression: `Object.keys(asyncFn)` is `[]`, so the old loop iterated
    // nothing and injected silently. Next resolves `entry` only after this
    // hook returns (webpack-config.ts), so the hook must wrap the function.
    const cfg = {
      entry: async () => ({
        main: ['./next/dist/client/next.js'],
        'main-app': ['./next/dist/client/app-next.js'],
      }),
    }
    const out = blazefire().webpack(cfg, { isServer })
    expect(typeof out.entry).toBe('function')

    return Promise.resolve(out.entry()).then((resolved) => {
      expect(resolved.main[0]).toBe(INJECT)
      // Regression: the app's own bootstrap must survive — the old code
      // assigned over the entry instead of prepending.
      expect(resolved.main).toEqual([INJECT, './next/dist/client/next.js'])
      expect(resolved['main-app']).toEqual([
        INJECT,
        './next/dist/client/app-next.js',
      ])
    })
  })

  it('prepends to an object entry without deleting entries', () => {
    const cfg = { entry: { main: ['./next/dist/client/next.js'] } }
    const out = blazefire().webpack(cfg, { isServer })
    expect(out.entry.main).toEqual([INJECT, './next/dist/client/next.js'])
  })

  it('is idempotent across repeated evaluation', () => {
    const cfg = { entry: { main: ['./next/dist/client/next.js'] } }
    blazefire().webpack(cfg, { isServer })
    blazefire().webpack(cfg, { isServer })
    expect(cfg.entry.main).toEqual([INJECT, './next/dist/client/next.js'])
  })

  it('never touches the server compilation', () => {
    const cfg = { entry: { main: ['./next/dist/server.js'] } }
    const out = blazefire().webpack(cfg, { isServer: true })
    expect(out.entry.main).toEqual(['./next/dist/server.js'])
  })

  it('does not throw when a chained hook left no entry', () => {
    expect(() => blazefire().webpack({}, { isServer })).not.toThrow()
    expect(() => blazefire().webpack(undefined, { isServer })).not.toThrow()
  })

  it('chains after a user webpack hook and tolerates one returning nothing', () => {
    const out = blazefire({
      webpack(config) {
        config.name = 'user'
        // deliberately returns undefined
      },
    })
    const cfg = { entry: { main: ['./next/dist/client/next.js'] } }
    const chained = out.webpack(cfg, { isServer })
    expect(chained.name).toBe('user')
    expect(chained.entry.main).toEqual([INJECT, './next/dist/client/next.js'])
  })

  it('chains after a user webpack hook that returns a Promise', () => {
    const out = blazefire({ webpack: (config) => Promise.resolve(config) })
    const cfg = { entry: { main: ['./next/dist/client/next.js'] } }
    const chained = out.webpack(cfg, { isServer })
    expect(typeof chained.then).not.toBe('function')
    expect(chained.entry.main).toEqual([INJECT, './next/dist/client/next.js'])
  })
})

describe('prependRuntimeToEntries', () => {
  it('handles string, array and descriptor entries', () => {
    expect(prependRuntimeToEntries({ a: './a.js' }, '/rt')).toEqual({
      a: ['/rt', './a.js'],
    })
    expect(prependRuntimeToEntries({ a: ['./a.js'] }, '/rt')).toEqual({
      a: ['/rt', './a.js'],
    })
    expect(prependRuntimeToEntries({ a: { import: ['./a.js'], dependOn: 'b' } }, '/rt')).toEqual({
      a: { import: ['/rt', './a.js'], dependOn: 'b' },
    })
  })

  it('leaves unknown shapes and missing entries untouched', () => {
    expect(prependRuntimeToEntries(undefined, '/rt')).toBeUndefined()
    expect(prependRuntimeToEntries(null, '/rt')).toBeNull()
    expect(prependRuntimeToEntries({ a: 42 }, '/rt')).toEqual({ a: 42 })
  })

  it('does not duplicate an already-injected runtime', () => {
    expect(prependRuntimeToEntries({ a: ['/rt', './a.js'] }, '/rt')).toEqual({
      a: ['/rt', './a.js'],
    })
    expect(prependRuntimeToEntries({ a: '/rt' }, '/rt')).toEqual({ a: ['/rt'] })
  })
})

describe('mergeConfigs', () => {
  it('preserves user turbopack root alongside our rules', () => {
    const out = mergeConfigs(
      { turbopack: { root: '/repo', rules: { '**/a.js': [{ loader: 'l' }] } } },
      { turbopack: { rules: { '**/b.js': [{ loader: 'm' }] } } }
    )
    expect(out.turbopack.root).toBe('/repo')
    expect(Object.keys(out.turbopack.rules).sort()).toEqual(['**/a.js', '**/b.js'])
  })

  it('layers our env over the user env rather than replacing it', () => {
    const out = mergeConfigs(
      { env: { NEXT_PUBLIC_APP: 'x' } },
      { env: { NEXT_PUBLIC_BLAZEFIRE: 'true', NEXT_PUBLIC_BLAZEFIRE_VERSION: 'v1.0.0' } }
    )
    // neither side is dropped
    expect(out.env).toEqual({
      NEXT_PUBLIC_APP: 'x',
      NEXT_PUBLIC_BLAZEFIRE: 'true',
      NEXT_PUBLIC_BLAZEFIRE_VERSION: 'v1.0.0',
    })
  })

  it('replacing happens only for scalars ours owns — user fields survive', () => {
    const out = mergeConfigs({ poweredByHeader: true, reactStrictMode: true }, { poweredByHeader: false })
    expect(out.poweredByHeader).toBe(false)
    expect(out.reactStrictMode).toBe(true)
  })
})

/** Await a `headers()`-style provider, whether it is a function or an array. */
function awaitValue(v) {
  return typeof v === 'function' ? v() : Promise.resolve(v)
}
