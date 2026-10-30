import {
  loadFrostfastBinding,
  resetBindingMemoForTests,
  resetWorkerSchedulerForTests,
  FrostfastBindingError,
  platformArchABI,
} from '../src/compiler/bindings'
import type {
  FrostfastBinding,
  LoadLadderDeps,
} from '../src/compiler/bindings'

describe('loadFrostfastBinding', () => {
  // The worker-scheduler latch (H-13) is module-level too; reset it here for
  // symmetry with project.test.ts so no ladder/scheduler state order-couples
  // these tests to each other or to other files (L-32).
  beforeEach(() => {
    resetBindingMemoForTests()
    resetWorkerSchedulerForTests()
  })
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

  // The dual-candidate ladder only exists on Linux (libc triples); skip
  // elsewhere rather than asserting a platform that cannot occur.
  const itLinux = process.platform === 'linux' ? it : it.skip

  itLinux('tries both gnu and musl candidates on Linux before failing (L-23)', async () => {
    const attempted: string[] = []
    const deps: LoadLadderDeps = {
      // No FROSTFAST_NATIVE_PATH override; the DIR rung supplies a concrete
      // path per abi so the require attempts are directly observable.
      env: (name) => (name === 'FROSTFAST_NATIVE_DIR' ? '/dir' : undefined),
      requireNative: (absolutePath) => {
        attempted.push(absolutePath)
        throw new Error('not a loadable native module')
      },
      resolveFrom: (_baseDir, specifier) => {
        attempted.push(specifier)
        return null
      },
      warn: () => undefined,
    }

    const failure = await loadFrostfastBinding(deps).then(
      () => undefined,
      (error: unknown) => error
    )
    expect(failure).toBeInstanceOf(FrostfastBindingError)

    // BOTH libc triples are probed: a wrong detection (process.report is
    // unavailable in bare Docker/scratch images) must degrade to a second
    // attempt, never a permanent "not found" naming the wrong package.
    expect(attempted).toContain('/dir/frostfast.linux-x64-gnu.node')
    expect(attempted).toContain('/dir/frostfast.linux-x64-musl.node')
    // The per-platform npm rungs cross-try too.
    expect(attempted).toContain('@frostfast/native/native/frostfast.linux-x64-musl.node')
    expect(attempted).toContain('@frostfast/linux-x64-musl/frostfast.linux-x64-musl.node')

    // The error names BOTH triples it tried, not just the detected one.
    const message = String(failure)
    expect(message).toContain('linux-x64-gnu')
    expect(message).toContain('linux-x64-musl')

    // Within a rung the DETECTED libc is attempted first (gnu on this glibc
    // host, musl on Alpine) — the cross-try is a fallback, not a reorder.
    const detected = platformArchABI()
    const crossTry = detected.endsWith('-gnu') ? 'musl' : 'gnu'
    expect(attempted.indexOf(`/dir/frostfast.${detected}.node`)).toBeLessThan(
      attempted.indexOf(`/dir/frostfast.linux-x64-${crossTry}.node`)
    )
  })
})
