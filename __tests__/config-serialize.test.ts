/**
 * serializeProjectConfig (H-08: compact, hash-gated) and the
 * v1-faithful serializability guard (H-09: refuse at the boundary, never
 * marshal-and-discard).
 */
import { createHash } from 'node:crypto'
import {
  ConfigChangeGate,
  rustifyEnv,
  serializePattern,
  serializeProjectConfig,
} from '../src/config/serialize'
import type { SerializableProjectConfig } from '../src/config/serialize'

function baseConfig(
  overrides: Partial<SerializableProjectConfig> = {}
): SerializableProjectConfig {
  return {
    rootPath: '/host',
    projectPath: '/host',
    distDir: '.next',
    dev: false,
    buildId: 'test-build',
    env: { NEXT_PUBLIC_A: 'a' },
    defineEnv: {},
    nextConfig: {},
    ...overrides,
  }
}

describe('serializeProjectConfig', () => {
  it('returns compact JSON (no indent bytes) plus its sha256', () => {
    const snapshot = serializeProjectConfig(baseConfig())
    expect(snapshot.json).not.toContain('\n')
    expect(snapshot.json).not.toMatch(/": /)
    expect(snapshot.hash).toBe(
      createHash('sha256').update(snapshot.json).digest('hex')
    )
  })

  it('parses back to the same fields it was given', () => {
    const snapshot = serializeProjectConfig(baseConfig())
    const parsed = JSON.parse(snapshot.json)
    expect(parsed.rootPath).toBe('/host')
    expect(parsed.distDir).toBe('.next')
    expect(parsed.env).toEqual([{ name: 'NEXT_PUBLIC_A', value: 'a' }])
  })

  it('normalizes Windows separators on the paths it owns', () => {
    const snapshot = serializeProjectConfig(
      baseConfig({ rootPath: 'C:\\host', distDir: '.next\\cache' })
    )
    const parsed = JSON.parse(snapshot.json)
    expect(parsed.rootPath).toBe('C:/host')
    expect(parsed.distDir).toBe('.next/cache')
  })

  it('carries a literal __proto__ key as data (no prototype swap, no silent drop)', () => {
    const nextConfig: Record<string, unknown> = { normal: 1 }
    Object.defineProperty(nextConfig, '__proto__', {
      value: { marker: 'keep-me' },
      enumerable: true,
      writable: true,
      configurable: true,
    })
    const mapValue = new Map<unknown, unknown>([['__proto__', 'map-marker']])

    const snapshot = serializeProjectConfig(baseConfig({ nextConfig: { ...nextConfig, mapValue } }))
    const parsed = JSON.parse(snapshot.json) as {
      nextConfig: Record<string, unknown>
    }

    // The key survives as an OWN key instead of invoking the Object.prototype
    // `__proto__` setter (which would drop it from the wire entirely).
    expect(Object.prototype.hasOwnProperty.call(parsed.nextConfig, '__proto__')).toBe(true)
    expect(parsed.nextConfig.__proto__).toEqual({ marker: 'keep-me' })
    // (JSON.parse, not an object literal: `{'__proto__': v}` sets the
    // prototype rather than defining an own key.)
    expect(parsed.nextConfig.mapValue).toEqual(JSON.parse('{"__proto__":"map-marker"}'))
    // And nothing leaked onto a real prototype.
    expect(Object.getPrototypeOf(parsed.nextConfig)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>).marker).toBeUndefined()
  })

  it('rustifies env into flat name/value tuples', () => {
    expect(rustifyEnv({ A: '1', B: undefined })).toEqual([
      { name: 'A', value: '1' },
      { name: 'B', value: undefined },
    ])
  })

  it('decomposes patterns: regex -> {type:regex}, string -> {type:glob}', () => {
    expect(serializePattern('**/x.js')).toEqual({ type: 'glob', value: '**/x.js' })
    expect(serializePattern(/ab+c/)).toEqual({
      type: 'regex',
      value: { source: 'ab+c', flags: '' },
    })
  })

  it('throws when loader options are not JSON-round-trippable (H-09)', () => {
    expect(() =>
      serializeProjectConfig(
        baseConfig({
          nextConfig: {
            turbopack: {
              rules: { '**/x.js': [{ loader: '/l.js', options: { fn: () => 1 } }] },
            },
          },
        })
      )
    ).toThrow(/not JSON-serializable/)
  })

  it('accepts JSON-round-trippable loader options', () => {
    expect(() =>
      serializeProjectConfig(
        baseConfig({
          nextConfig: {
            turbopack: {
              rules: { '**/x.js': [{ loader: '/l.js', options: { plain: 'json' } }] },
            },
          },
        })
      )
    ).not.toThrow()
  })
})

describe('ConfigChangeGate', () => {
  it('changed() is true until a snapshot is remembered', () => {
    const gate = new ConfigChangeGate()
    const snapshot = serializeProjectConfig(baseConfig())

    expect(gate.changed(snapshot)).toBe(true)
    gate.remember(snapshot)
    expect(gate.changed(snapshot)).toBe(false)
  })

  it('detects a real config change through the hash', () => {
    const gate = new ConfigChangeGate()
    const first = serializeProjectConfig(baseConfig())
    gate.remember(first)

    const second = serializeProjectConfig(
      baseConfig({ env: { NEXT_PUBLIC_A: 'different' } })
    )
    expect(gate.changed(second)).toBe(true)
  })

  it('reset() forgets the remembered snapshot', () => {
    const gate = new ConfigChangeGate()
    const snapshot = serializeProjectConfig(baseConfig())
    gate.remember(snapshot)
    gate.reset()
    expect(gate.changed(snapshot)).toBe(true)
  })
})
