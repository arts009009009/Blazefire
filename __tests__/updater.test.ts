import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkForUpdate } from '../src/update-check/feed'
import { runUpdate } from '../src/update-check/updater'

jest.mock('node:child_process', () => ({ spawnSync: jest.fn() }))
jest.mock('../src/update-check/feed', () => ({ checkForUpdate: jest.fn() }))

describe('runUpdate', () => {
  let projectRoot: string

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'blazefire-update-'))
    ;(checkForUpdate as jest.Mock).mockResolvedValue({
      current: '2.0.0',
      latest: '2.1.0',
      updateAvailable: true,
    })
    ;(spawnSync as jest.Mock).mockReset().mockReturnValue({ status: 1 })
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
  })

  it('does not overwrite a non-registry dependency spec', async () => {
    writeFileSync(
      join(projectRoot, 'package.json'),
      JSON.stringify({ devDependencies: { blazefire: 'github:team/blazefire#main' } })
    )

    const messages: string[] = []
    await expect(
      runUpdate({ projectRoot, onLog: (message) => messages.push(message) })
    ).resolves.toBe(1)

    expect(messages[0]).toContain('github:team/blazefire#main')
    expect(checkForUpdate).not.toHaveBeenCalled()
    expect(spawnSync).not.toHaveBeenCalled()
  })

  it('refuses malformed release versions before invoking the package manager', async () => {
    ;(checkForUpdate as jest.Mock).mockResolvedValue({
      current: '2.0.0',
      latest: '2.1.0/other',
      updateAvailable: true,
    })

    await expect(runUpdate({ projectRoot, onLog: () => undefined })).resolves.toBe(1)

    expect(spawnSync).not.toHaveBeenCalled()
  })

  it('preserves the installed package and lockfile when installation fails', async () => {
    const installedPackage = join(projectRoot, 'node_modules', 'blazefire')
    const lockfile = join(projectRoot, 'package-lock.json')
    mkdirSync(installedPackage, { recursive: true })
    writeFileSync(join(installedPackage, 'package.json'), '{"name":"blazefire"}')
    writeFileSync(lockfile, '{"lockfileVersion":3}')
    writeFileSync(
      join(projectRoot, 'package.json'),
      JSON.stringify({ devDependencies: { blazefire: '^2.0.0' } })
    )

    await expect(runUpdate({ projectRoot, onLog: () => undefined })).resolves.toBe(1)

    expect(existsSync(join(installedPackage, 'package.json'))).toBe(true)
    expect(existsSync(lockfile)).toBe(true)
    expect(spawnSync).toHaveBeenCalledTimes(1)
  })
})
