/**
 * mergeConfigs — the wrap-not-replace contract.
 */
import { mergeConfigs } from '../src/config/merge'
import { BlazefireConfigError } from '../src/config/types'
import type { NextConfigLike } from '../src/config/types'

describe('mergeConfigs', () => {
  it('keeps host keys that blazefire does not set', () => {
    const merged = mergeConfigs({ output: 'standalone' } as NextConfigLike, {
      env: { A: '1' },
    })
    expect(merged.output).toBe('standalone')
    expect(merged.env).toEqual({ A: '1' })
  })

  it('lets the blazefire half win on conflicts', () => {
    const merged = mergeConfigs({ poweredByHeader: true } as NextConfigLike, {
      poweredByHeader: false,
    })
    expect(merged.poweredByHeader).toBe(false)
  })

  it('does not let a __proto__ glob corrupt the merged turbopack rules', () => {
    const evilRules: Record<string, unknown> = {}
    Object.defineProperty(evilRules, '__proto__', {
      value: [{ loader: '/tmp/evil-loader.js' }],
      enumerable: true,
      writable: true,
      configurable: true,
    })

    const merged = mergeConfigs(
      { turbopack: { rules: { '**/*.ts': [{ loader: '/tmp/a.js' }] } } } as unknown as NextConfigLike,
      { turbopack: { rules: evilRules } } as unknown as NextConfigLike
    )

    const rules = merged.turbopack!.rules as Record<string, unknown>
    // Plain assignment would have swapped the rules object's prototype for
    // the loader array instead of adding a glob.
    expect(Object.getPrototypeOf(rules)).toBe(Object.prototype)
    expect(Object.prototype.hasOwnProperty.call(rules, '__proto__')).toBe(true)
    expect(rules.__proto__).toEqual([{ loader: '/tmp/evil-loader.js' }])
    expect(({} as Record<string, unknown>).loader).toBeUndefined()
    // The real glob is untouched.
    expect(rules['**/*.ts']).toEqual([{ loader: '/tmp/a.js' }])
  })

  it('concatenates headers instead of replacing them', () => {
    const merged = mergeConfigs(
      {
        headers: async () => [
          { source: '/host', headers: [{ key: 'X-Host', value: '1' }] },
        ],
      } as NextConfigLike,
      {
        headers: async () => [
          { source: '/:path*', headers: [{ key: 'X-Powered-By', value: 'Blazefire Framework' }] },
        ],
      }
    )

    return Promise.resolve(merged.headers?.()).then((headers) => {
      expect(headers).toHaveLength(2)
      expect(headers?.[0]?.source).toBe('/host')
      expect(headers?.[1]?.source).toBe('/:path*')
    })
  })

  it('concatenates redirects the same way', async () => {
    const merged = mergeConfigs(
      { redirects: async () => [{ source: '/a', destination: '/b', permanent: false }] },
      { redirects: async () => [{ source: '/c', destination: '/d', permanent: true }] }
    )
    const redirects = await merged.redirects?.()
    expect(redirects).toHaveLength(2)
  })

  it('merges turbopack.rules from both halves', () => {
    const merged = mergeConfigs(
      { turbopack: { rules: { '**/host.ts': [{ loader: '/host-loader.js' }] } } } as NextConfigLike,
      { turbopack: { rules: { '**/next*.js': [{ loader: '/bf.js' }] } } } as NextConfigLike
    )
    expect(Object.keys(merged.turbopack?.rules ?? {})).toEqual(
      expect.arrayContaining(['**/host.ts', '**/next*.js'])
    )
  })

  it('preserves host loaders when both configs use the same turbopack glob', () => {
    const merged = mergeConfigs(
      {
        turbopack: {
          rules: { '**/next*.js': [{ loader: '/host-loader.js' }] },
        },
      } as NextConfigLike,
      {
        turbopack: {
          rules: { '**/next*.js': [{ loader: '/blazefire-loader.js' }] },
        },
      } as NextConfigLike
    )

    expect(merged.turbopack?.rules?.['**/next*.js']).toEqual([
      { loader: '/host-loader.js' },
      { loader: '/blazefire-loader.js' },
    ])
  })

  it('wraps when the blazefire half replaces a scalar with the same value', () => {
    const merged = mergeConfigs({ poweredByHeader: false } as NextConfigLike, {
      poweredByHeader: false,
    })
    expect(merged.poweredByHeader).toBe(false)
  })

  it('rejects a webpack() hook on the host config', () => {
    expect(() =>
      mergeConfigs(
        {
          webpack: () => {
            throw new Error('never runs')
          },
        } as unknown as NextConfigLike,
        {}
      )
    ).toThrow(BlazefireConfigError)
  })
})
