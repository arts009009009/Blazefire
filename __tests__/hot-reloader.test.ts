import { createHotReloader } from '../src/dev/hot-reloader'
import type { FrostfastProject } from '../src/compiler/project'

describe('createHotReloader', () => {
  it('keeps one HMR stream when a chunk is unsubscribed and resubscribed', async () => {
    const project = {
      entrypointEvents: async function* () {},
      updateInfoEvents: async function* () {},
      hmrEvents: jest.fn(async function* () {
        await new Promise<void>(() => {})
      }),
    } as unknown as FrostfastProject

    const reloader = await createHotReloader({ project, emit: () => undefined })
    const unsubscribe = await reloader.subscribeClient('app')
    await unsubscribe()
    await reloader.subscribeClient('app')

    expect(project.hmrEvents).toHaveBeenCalledTimes(1)
    await reloader.dispose()
  })
})
