/**
 * blazefire() — the wrapper contract: merge-not-replace, options by value
 * type, function-config support, no webpack hook.
 */
import { blazefire, buildConfig } from '../src/plugin'
import { BlazefireConfigError } from '../src/config/types'
import type { BlazefireOptions, NextConfigLike } from '../src/config/types'

type HeadersProvider = () => Promise<
  Array<{ source: string; headers: Array<{ key: string; value: string }> }>
>

describe('buildConfig', () => {
  it('publishes the runtime toggles as NEXT_PUBLIC_ env values', () => {
    const config = buildConfig({ theme: true, overlay: true } as BlazefireOptions)
    expect(config.env).toMatchObject({
      NEXT_PUBLIC_BLAZEFIRE: 'true',
      NEXT_PUBLIC_BLAZEFIRE_THEME: 'true',
      NEXT_PUBLIC_BLAZEFIRE_OVERLAY: 'true',
    })
  })

  it('honours theme:false/headers:false in the toggles and drops the loader', () => {
    const config = buildConfig({ theme: false, overlay: false, headers: false } as BlazefireOptions)
    expect(config.env?.NEXT_PUBLIC_BLAZEFIRE_THEME).toBe('false')
    expect(config.turbopack?.rules).toEqual({})
    expect(config.poweredByHeader).toBeUndefined() // no headers -> keep host's
    expect(config.headers).toBeUndefined()
  })

  it('supports custom header values (v1 opts)', async () => {
    const config = buildConfig({
      theme: false,
      overlay: false,
      poweredBy: 'My Framework',
    } as BlazefireOptions)
    const routes = await (config.headers as HeadersProvider)()
    const all = routes.flatMap((route) => route.headers)
    expect(all).toContainEqual({
      key: 'X-Powered-By',
      value: 'My Framework',
    })
  })
})

describe('blazefire()', () => {
  it('wraps an existing config and keeps host keys', () => {
    const merged = blazefire({ output: 'standalone' } as NextConfigLike) as NextConfigLike
    expect(merged.output).toBe('standalone')
    expect(merged.env?.NEXT_PUBLIC_BLAZEFIRE).toBe('true')
  })

  it('accepts options as the second argument', () => {
    const merged = blazefire({} as NextConfigLike, { theme: false }) as NextConfigLike
    expect(merged.env?.NEXT_PUBLIC_BLAZEFIRE_THEME).toBe('false')
  })

  it('recognises options mixed into a single argument', () => {
    const merged = blazefire({ trailingSlash: true, overlay: false }) as NextConfigLike
    expect(merged.trailingSlash).toBe(true)
    expect(merged.env?.NEXT_PUBLIC_BLAZEFIRE_OVERLAY).toBe('false')
    // The option must not leak into the host config half.
    expect((merged as Record<string, unknown>).overlay).toBeUndefined()
  })

  it('supports function configs without swallowing the user config', async () => {
    const wrapped = blazefire(() => ({ reactStrictMode: true })) as (
      phase: string,
      ctx: unknown
    ) => Promise<NextConfigLike>
    const resolved = await wrapped('phase', {})
    expect(resolved.reactStrictMode).toBe(true)
    expect(resolved.env?.NEXT_PUBLIC_BLAZEFIRE).toBe('true')
  })

  it('supports async function configs', async () => {
    const wrapped = blazefire(async () => ({ reactStrictMode: false })) as (
      phase: string,
      ctx: unknown
    ) => Promise<NextConfigLike>
    const resolved = await wrapped('phase', {})
    expect(resolved.reactStrictMode).toBe(false)
  })

  it('throws BlazefireConfigError when a webpack hook is present', () => {
    expect(() =>
      blazefire({ webpack: () => ({}) } as unknown as NextConfigLike)
    ).toThrow(BlazefireConfigError)
  })

  it('throws for a PROTOTYPE-level webpack() on a class config (H-01 cannot be evaded)', () => {
    class WithWebpack {
      reactStrictMode = true // own field: omitOptions() would copy only this
      webpack(): Record<string, unknown> {
        return {}
      }
    }
    expect(() => blazefire(new WithWebpack() as unknown as NextConfigLike)).toThrow(
      BlazefireConfigError
    )
  })

  it('keeps a config carried on a prototype chain instead of treating it as options', () => {
    // Shared config base: no own keys, everything inherited. Object.keys()
    // sees nothing, so this used to be classified as an options bag and the
    // whole config was silently dropped.
    const proto = { output: 'standalone' as const }
    const config = Object.create(proto) as NextConfigLike

    const merged = blazefire(config)
    expect(merged.output).toBe('standalone')
    expect(merged.env?.NEXT_PUBLIC_BLAZEFIRE).toBe('true')
  })

  it('preserves host headers(), redirects(), rewrites() via merge', async () => {
    const merged = blazefire({
      headers: async () => [{ source: '/x', headers: [{ key: 'X-1', value: '1' }] }],
    } as NextConfigLike) as NextConfigLike

    const headers = await merged.headers?.()
    expect(headers).toHaveLength(2) // host + blazefire
  })
})
