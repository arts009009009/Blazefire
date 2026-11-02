import { createHotReloader } from '../src/dev/hot-reloader'
import type { FrostfastProject } from '../src/compiler/project'

describe('createHotReloader', () => {
  it('cancels the chunk stream when its last subscriber leaves, and starts a fresh one on resubscribe', async () => {
    const signals: AbortSignal[] = []
    const project = {
      entrypointEvents: async function* () {},
      updateInfoEvents: async function* () {},
      hmrEvents: jest.fn(async function* (
        _chunkName: string,
        _target: unknown,
        signal?: AbortSignal
      ) {
        if (signal) signals.push(signal)
        await new Promise<void>((resolve) =>
          signal?.addEventListener('abort', resolve, { once: true })
        )
      }),
    } as unknown as FrostfastProject

    const reloader = await createHotReloader({ project, emit: () => undefined })
    const unsubscribe = await reloader.subscribeClient('app')
    await unsubscribe()

    // The native stream must not outlive its last subscriber (a browsing
    // session would otherwise accumulate one RootTask per chunk ever visited).
    expect(signals[0]?.aborted).toBe(true)

    // Resubscribing revives the chunk with a NEW stream instead of joining
    // the dead one.
    await reloader.subscribeClient('app')
    expect(project.hmrEvents).toHaveBeenCalledTimes(2)
    await reloader.dispose()
  })

  it('reuses a live stream while any subscriber remains', async () => {
    const project = {
      entrypointEvents: async function* () {},
      updateInfoEvents: async function* () {},
      hmrEvents: jest.fn(async function* (
        _chunkName: string,
        _target: unknown,
        signal?: AbortSignal
      ) {
        await new Promise<void>((resolve) =>
          signal?.addEventListener('abort', resolve, { once: true })
        )
      }),
    } as unknown as FrostfastProject

    const reloader = await createHotReloader({ project, emit: () => undefined })
    const unsubA = await reloader.subscribeClient('app')
    const unsubB = await reloader.subscribeClient('app')
    await unsubA() // one subscriber remains: the stream must stay up
    await reloader.subscribeClient('app')

    expect(project.hmrEvents).toHaveBeenCalledTimes(1)
    await unsubB()
    await reloader.dispose()
  })

  it('restarts a chunk stream after a transient failure instead of going permanently silent', async () => {
    const streamError = new Error('native event stream failed')
    let calls = 0
    const project = {
      entrypointEvents: async function* () {},
      updateInfoEvents: async function* () {},
      hmrEvents: async function* (
        _chunkName: string,
        _target: unknown,
        signal?: AbortSignal
      ) {
        calls += 1
        if (calls === 1) throw streamError
        await new Promise<void>((resolve) =>
          signal?.addEventListener('abort', resolve, { once: true })
        )
      },
    } as unknown as FrostfastProject

    const onError = jest.fn()
    const reloader = await createHotReloader({
      project,
      emit: () => undefined,
      onError,
    })
    const received: unknown[] = []
    await reloader.subscribeClient('app', (payload) => received.push(payload))

    // The failed first stream is retried (bounded backoff); the revived
    // stream delivers to the still-subscribed listener.
    await new Promise<void>((resolve) => setTimeout(resolve, 400))

    expect(onError).toHaveBeenCalledWith(streamError)
    expect(calls).toBeGreaterThanOrEqual(2)
    await reloader.dispose()
  })

  it('reports stream failures without creating unhandled rejections', async () => {
    const streamError = new Error('native event stream failed')
    const onError = jest.fn()
    const project = {
      entrypointEvents: async function* () {
        throw streamError
      },
      updateInfoEvents: async function* () {},
      hmrEvents: async function* () {},
    } as unknown as FrostfastProject

    const reloader = await createHotReloader({ project, emit: () => undefined, onError })
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(onError).toHaveBeenCalledWith(streamError)
    await reloader.dispose()
  })

  it('passes cancellation to all native event streams on dispose', async () => {
    const signals: AbortSignal[] = []
    const stream = (signal?: AbortSignal) => ({
      async *[Symbol.asyncIterator]() {
        if (signal) signals.push(signal)
        await new Promise<void>((resolve) =>
          signal?.addEventListener('abort', resolve, { once: true })
        )
      },
    })
    const project = {
      entrypointEvents: jest.fn((signal?: AbortSignal) => stream(signal)),
      updateInfoEvents: jest.fn((_aggregationMs: number, signal?: AbortSignal) => stream(signal)),
      hmrEvents: jest.fn((_chunkName: string, _target: unknown, signal?: AbortSignal) =>
        stream(signal)
      ),
    } as unknown as FrostfastProject
    const reloader = await createHotReloader({ project, emit: () => undefined })
    await reloader.subscribeClient('app')

    await reloader.dispose()

    expect(signals).toHaveLength(3)
    expect(signals.every((signal) => signal.aborted)).toBe(true)
  })
})
