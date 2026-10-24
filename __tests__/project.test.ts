import { FrostfastProject, getRouteNames } from '../src/compiler/project'
import type {
  FrostfastBinding,
  NapiEntrypoints,
  ProjectHandle,
  RootTaskHandle,
} from '../src/compiler/native-contract'

function makeProjectUpdateMock() {
  const handle = {} as ProjectHandle
  const binding = {
    projectNew: jest.fn().mockResolvedValue(handle),
    projectUpdate: jest.fn().mockResolvedValue(undefined),
  } as unknown as FrostfastBinding

  return { binding, handle }
}

describe('getRouteNames', () => {
  it('reads route names from the native Map', () => {
    const entrypoints = {
      routes: new Map([
        ['/home', { type: 'app-page' }],
        ['/api', { type: 'app-route' }],
      ]),
    } as NapiEntrypoints

    expect(getRouteNames(entrypoints)).toEqual(['/home', '/api'])
  })
})

async function createProject(binding: FrostfastBinding): Promise<FrostfastProject> {
  return FrostfastProject.create({
    binding,
    rootPath: '/old',
    projectPath: '/old',
    distDir: '.next',
    dev: true,
    buildId: 'test',
    env: {},
    defineEnv: {},
    nextConfig: {},
  })
}

describe('FrostfastProject.update', () => {
  it('retains path changes in later serialized updates', async () => {
    const { binding } = makeProjectUpdateMock()
    const project = await createProject(binding)

    await project.update({ rootPath: '/new' })
    await project.update({ env: { NEXT_PUBLIC_TEST: '1' } })

    const secondUpdate = (binding.projectUpdate as jest.Mock).mock.calls[1]![1]
    expect(JSON.parse(secondUpdate.nextConfig).rootPath).toBe('/new')
  })

  it('does not advance its change gate when the native update fails', async () => {
    const { binding } = makeProjectUpdateMock()
    const project = await createProject(binding)
    const update = { env: { NEXT_PUBLIC_TEST: '1' } }
    ;(binding.projectUpdate as jest.Mock)
      .mockRejectedValueOnce(new Error('native update failed'))
      .mockResolvedValueOnce(undefined)

    await expect(project.update(update)).rejects.toThrow('native update failed')
    await expect(project.update(update)).resolves.toBe(true)
    expect(binding.projectUpdate).toHaveBeenCalledTimes(2)
  })
})

describe('FrostfastProject event streams', () => {
  it('forwards callback events and disposes the native task on abort', async () => {
    const handle = {} as ProjectHandle
    const task = {} as RootTaskHandle
    const entrypoints = {
      routes: new Map([['/home', { type: 'app-page' as const }]]),
    }
    const binding = {
      projectNew: jest.fn().mockResolvedValue(handle),
      projectEntrypointsSubscribe: jest.fn((_handle, callback) => {
        callback(null, { value: entrypoints })
        return task
      }),
      rootTaskDispose: jest.fn(),
    } as unknown as FrostfastBinding
    const project = await createProject(binding)
    const controller = new AbortController()
    const events = project.entrypointEvents(controller.signal)[Symbol.asyncIterator]()

    await expect(events.next()).resolves.toEqual({ done: false, value: entrypoints })
    const pending = events.next()
    controller.abort()
    await expect(pending).resolves.toEqual({ done: true, value: undefined })
    expect(binding.rootTaskDispose).toHaveBeenCalledWith(task)
  })

  it('normalizes an empty native entrypoint result to an empty route set', async () => {
    const handle = {} as ProjectHandle
    const task = {} as RootTaskHandle
    const binding = {
      projectNew: jest.fn().mockResolvedValue(handle),
      projectEntrypointsSubscribe: jest.fn((_handle, callback) => {
        callback(null, { value: {} })
        return task
      }),
      rootTaskDispose: jest.fn(),
    } as unknown as FrostfastBinding
    const project = await createProject(binding)
    const events = project.entrypointEvents()[Symbol.asyncIterator]()

    await expect(events.next()).resolves.toEqual({
      done: false,
      value: { routes: new Map() },
    })
    await events.return?.()
    expect(binding.rootTaskDispose).toHaveBeenCalledWith(task)
  })

  it('normalizes native update messages and propagates native stream errors', async () => {
    const handle = {} as ProjectHandle
    const task = {} as RootTaskHandle
    const nativeError = new Error('native subscription failed')
    const binding = {
      projectNew: jest.fn().mockResolvedValue(handle),
      projectUpdateInfoSubscribe: jest.fn((_handle, _aggregationMs, callback) => {
        callback(null, { updateType: 'start' })
        callback(nativeError, undefined)
        return task
      }),
      rootTaskDispose: jest.fn(),
    } as unknown as FrostfastBinding
    const project = await createProject(binding)
    const events = project.updateInfoEvents()[Symbol.asyncIterator]()

    await expect(events.next()).resolves.toEqual({ done: false, value: { type: 'start' } })
    await expect(events.next()).rejects.toThrow('native subscription failed')
    expect(binding.rootTaskDispose).toHaveBeenCalledWith(task)
  })
})
