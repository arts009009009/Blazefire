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
})
