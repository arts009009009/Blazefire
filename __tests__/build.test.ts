import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadFrostfastBinding } from '../src/compiler/bindings'
import { FrostfastProject } from '../src/compiler/project'
import { frostfastBuild } from '../src/build'

jest.mock('../src/compiler/bindings', () => ({
  loadFrostfastBinding: jest.fn().mockResolvedValue({}),
}))

jest.mock('../src/compiler/project', () => ({
  FrostfastProject: { create: jest.fn() },
  getRouteNames: jest.fn(() => ['/']),
}))

describe('frostfastBuild', () => {
  let projectRoot: string
  let project: {
    writeAllEntrypointsToDisk: jest.Mock
    entrypoints: jest.Mock
    shutdown: jest.Mock
  }

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'blazefire-build-'))
    project = {
      writeAllEntrypointsToDisk: jest.fn().mockResolvedValue(undefined),
      entrypoints: jest.fn().mockResolvedValue({ routes: new Map() }),
      shutdown: jest.fn().mockResolvedValue(undefined),
    }
    ;(loadFrostfastBinding as jest.Mock).mockResolvedValue({})
    ;(FrostfastProject.create as jest.Mock).mockResolvedValue(project)
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
    jest.clearAllMocks()
  })

  it('resolves a relative output directory against the project root', async () => {
    const distDir = join(projectRoot, 'artifacts')
    mkdirSync(join(distDir, 'cache'), { recursive: true })
    writeFileSync(join(distDir, 'cache', 'graph'), 'keep')
    writeFileSync(join(distDir, 'old-manifest'), 'remove')

    const result = await frostfastBuild({ dir: projectRoot, distDir: 'artifacts' })

    expect(result.distDir).toBe(distDir)
    expect(FrostfastProject.create).toHaveBeenCalledWith(
      expect.objectContaining({
        rootPath: projectRoot,
        projectPath: projectRoot,
        distDir,
      })
    )
    expect(existsSync(join(distDir, 'old-manifest'))).toBe(false)
    expect(existsSync(join(distDir, 'cache', 'graph'))).toBe(true)
    // Marker files written by the JS side before entrypoints cross: the
    // turbopack marker and the CJS package.json Node needs to load dist.
    expect(readFileSync(join(distDir, 'turbopack'), 'utf8')).toBe('')
    expect(JSON.parse(readFileSync(join(distDir, 'package.json'), 'utf8'))).toEqual({
      type: 'commonjs',
    })
    expect(project.shutdown).toHaveBeenCalledTimes(1)
  })

  it('refuses a distDir that would wipe the project root or its parents', async () => {
    ;(FrostfastProject.create as jest.Mock).mockClear()
    const sentinel = join(projectRoot, 'package.json')
    writeFileSync(sentinel, JSON.stringify({ name: 'precious' }))

    for (const distDir of ['.', '..', join(projectRoot, '..'), projectRoot]) {
      await expect(frostfastBuild({ dir: projectRoot, distDir })).rejects.toThrow(
        /refusing to clean/
      )
      expect(FrostfastProject.create).not.toHaveBeenCalled()
      expect(existsSync(sentinel)).toBe(true)
    }
  })

  it('refuses an output symlink that resolves to the project root', async () => {
    const sentinel = join(projectRoot, 'package.json')
    writeFileSync(sentinel, JSON.stringify({ name: 'precious' }))
    symlinkSync(projectRoot, join(projectRoot, 'artifacts'), 'dir')

    await expect(frostfastBuild({ dir: projectRoot, distDir: 'artifacts' })).rejects.toThrow(
      /refusing to clean/
    )
    expect(existsSync(sentinel)).toBe(true)
    expect(FrostfastProject.create).not.toHaveBeenCalled()
  })
})
