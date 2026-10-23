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
import type { NextConfigLike } from '../src/config/types'

describe('serializeProjectConfig', () => {
  it('round-trips the serialized config through JSON identically', () => {
    const config = {
      env: { NEXT_PUBLIC_A: 'a', NEXT_PUBLIC_B: 'b' },
      generateBuildId: async () => 'fixed-id',
    } as unknown as NextConfigLike

    const serialized = serializeProjectConfig(config)
    expect(JSON.parse(JSON.stringify(serialized))).toEqual(serialized)
  })

  it('rustifies only NEXT_PUBLIC_ env keys', () => {
    const rustified = rustifyEnv({
      NEXT_PUBLIC_OK: 'yes',
      SECRET: 'no',
      SERVER_ONLY: 'no',
    })
    expect(rustified).toEqual([{ definition: { key: 'NEXT_PUBLIC_OK', value: 'yes' } }])
  })

  it('serializes turbopack rules globs into patterns', () => {
    const pattern = serializePattern('**/next/dist/client/app-next*.js')
    expect(pattern.glob).toContain('app-next')
  })

  it('throws when loader options are not JSON-round-trippable (H-09)', () => {
    const config = {
      turbopack: {
        rules: {
          '**/x.js': [{ loader: '/l.js', options: { fn: () => 1 } }],
        },
      },
    } as unknown as NextConfigLike

    expect(() => serializeProjectConfig(config)).toThrow(/not JSON-serializable/)
  })

  it('accepts JSON-round-trippable loader options', () => {
    const config = {
      turbopack: {
        rules: {
          '**/x.js': [{ loader: '/l.js', options: { plain: 'json', n: 3 } }],
        },
      },
    } as unknown as NextConfigLike

    expect(() => serializeProjectConfig(config)).not.toThrow()
  })
})

describe('ConfigChangeGate', () => {
  it('fires only when the serialized form changes', () => {
    const gate = new ConfigChangeGate()
    const config = { env: { NEXT_PUBLIC_A: '1' } } as NextConfigLike

    expect(gate.consider(config)).toBe(true) // first observation
    expect(gate.consider(config)).toBe(false) // unchanged
    expect(
      gate.consider({ env: { NEXT_PUBLIC_A: '2' } } as NextConfigLike)
    ).toBe(true)
  })

  it('hashes the compact serialization (no pretty-printing)', () => {
    const gate = new ConfigChangeGate()
    gate.consider({ env: { NEXT_PUBLIC_A: '1' } } as NextConfigLike)
    const expected = createHash('sha256')
      .update(JSON.stringify({ env: { NEXT_PUBLIC_A: '1' } }))
      .digest('hex')
    expect(gate.lastHash()).toBe(expected)
  })
})
