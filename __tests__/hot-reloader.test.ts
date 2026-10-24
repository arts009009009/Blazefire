import { createHotReloader } from '../src/dev/hot-reloader'
import type { FrostfastProject } from '../src/compiler/project'

describe('createHotReloader', () => {
  it('keeps one HMR stream when a chunk is unsubscribed and resubscribed', async () => {
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
    const unsubscribe = await reloader.subscribeClient('app')
    await unsubscribe()
    await reloader.subscribeClient('app')

    expect(project.hmrEvents).toHaveBeenCalledTimes(1)
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

    await createHotReloader({ project, emit: () => undefined, onError })
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(onError).toHaveBeenCalledWith(streamError)
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
