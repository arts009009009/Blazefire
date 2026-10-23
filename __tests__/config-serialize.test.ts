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
