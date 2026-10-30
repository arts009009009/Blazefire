import {
  loadFrostfastBinding,
  resetBindingMemoForTests,
} from '../src/compiler/bindings'
import type {
  FrostfastBinding,
  LoadLadderDeps,
} from '../src/compiler/bindings'

describe('loadFrostfastBinding', () => {
  beforeEach(() => resetBindingMemoForTests())
  afterEach(() => resetBindingMemoForTests())

  it('clears a rejected load so a later attempt can succeed', async () => {
    let available = false
    const binding = {} as FrostfastBinding
    const deps: LoadLadderDeps = {
      env: (name) => (name === 'FROSTFAST_NATIVE_PATH' ? '/tmp/frostfast.node' : undefined),
      requireNative: () => {
        if (!available) throw new Error('native binary unavailable')
        return binding
      },
      resolveFrom: () => null,
      warn: () => undefined,
    }

    await expect(loadFrostfastBinding(deps)).rejects.toThrow('native binary unavailable')
    available = true
    await expect(loadFrostfastBinding(deps)).resolves.toBe(binding)
  })

  it('resolves a relative FROSTFAST_NATIVE_DIR as a PATH, never as a package name', async () => {
    const binding = {} as FrostfastBinding
    const attempted: string[] = []
    const deps: LoadLadderDeps = {
      env: (name) => {
        if (name === 'FROSTFAST_NATIVE_DIR') return 'target/release' // relative on purpose
        if (name === 'INIT_CWD') return '/proj'
        return undefined
      },
      requireNative: (absolutePath) => {
        attempted.push(absolutePath)
        return binding
      },
      resolveFrom: () => null,
      warn: () => undefined,
    }

    await expect(loadFrostfastBinding(deps)).resolves.toBe(binding)
    // A bare relative specifier would be resolved by require() through
    // node_modules lookup (an npm PACKAGE), not as the path it is.
    expect(attempted[0]).toMatch(/^\/proj\/target\/release\/frostfast\..+\.node$/)
  })
})
