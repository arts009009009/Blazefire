import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BACKUP_DIR,
  HOOK_COMMAND,
  isLifecycleHook,
  restore,
} from '../src/postinstall/activation'

describe('restore', () => {
  let projectRoot: string

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'blazefire-restore-'))
    mkdirSync(join(projectRoot, BACKUP_DIR))
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
  })

  it('restores config filenames that contain multiple dots', () => {
    const configName = 'next.config.js'
    const liveConfig = join(projectRoot, configName)
    const original = 'module.exports = { reactStrictMode: true }\n'
    writeFileSync(liveConfig, 'module.exports = blazefire({ reactStrictMode: true })\n')
    writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({
      scripts: { postinstall: HOOK_COMMAND },
    }))
    writeFileSync(
      join(projectRoot, BACKUP_DIR, `${configName}.2026-10-24T11-00-00-000Z.original`),
      original
    )

    expect(restore(projectRoot)).toBe(true)
    expect(readFileSync(liveConfig, 'utf8')).toBe(original)
    expect(existsSync(join(projectRoot, 'package.json'))).toBe(true)
    expect(
      JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')).scripts.postinstall
    ).toBeUndefined()
  })

  it('restores the earliest pristine backup and removes only a real Blazefire hook', () => {
    const liveConfig = join(projectRoot, 'next.config.js')
    const original = 'module.exports = { reactStrictMode: true }\n'
    const previouslyWrapped = 'module.exports = blazefire({ reactStrictMode: true })\n'
    writeFileSync(liveConfig, previouslyWrapped)
    writeFileSync(
      join(projectRoot, 'package.json'),
      JSON.stringify({ scripts: { postinstall: 'echo "blazefire is installed"' } })
    )
    writeFileSync(
      join(projectRoot, BACKUP_DIR, 'next.config.js.2026-01-01T00-00-00-000Z.original'),
      original
    )
    writeFileSync(
      join(projectRoot, BACKUP_DIR, 'next.config.js.2026-02-01T00-00-00-000Z.original'),
      previouslyWrapped
    )

    expect(restore(projectRoot)).toBe(true)
    expect(readFileSync(liveConfig, 'utf8')).toBe(original)
    expect(isLifecycleHook('echo "blazefire is installed"')).toBe(false)
    expect(JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')).scripts.postinstall)
      .toBe('echo "blazefire is installed"')
  })
})
