import { FrostfastProject, getRouteNames } from '../src/compiler/project'
import type {
  FrostfastBinding,
  NapiEntrypoints,
  ProjectHandle,
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
