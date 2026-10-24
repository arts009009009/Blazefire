/**
 * Update check — v1 semantics: compareVersions, throttle state, safe-spec
 * gating, npm lockfile surgery.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CHECK_INTERVAL_MS,
  compareVersions,
  isValidVersion,
  isSafeSpec,
  purgeCachedInstall,
  readState,
  recentlyChecked,
  removeNpmLockEntry,
  specTarget,
  stateFile,
  updateCommand,
  writeState,
} from '../src/update-check'

describe('compareVersions', () => {
  it('orders releases numerically, not lexically', () => {
    expect(compareVersions('1.9.0', '1.10.0')).toBeLessThan(0)
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0)
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
  })

  it('accepts the v prefix from git tags', () => {
    expect(compareVersions('1.2.3', 'v1.2.3')).toBe(0)
    expect(compareVersions('v1.2.4', '1.2.3')).toBeGreaterThan(0)
  })

  it('sorts pre-releases below their release', () => {
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBeLessThan(0)
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0-rc.1', '1.0.0-rc.2')).toBeLessThan(0)
  })

  it('treats unparseable versions as equal (never nag on garbage)', () => {
    expect(compareVersions('canary', '1.0.0')).toBe(0)
    expect(compareVersions('', '')).toBe(0)
    expect(compareVersions('1.2.3-not-a-version!', '1.2.4')).toBe(0)
    expect(compareVersions('1.2.3suffix', '1.2.4')).toBe(0)
    expect(compareVersions('1.2.3-..', '1.2.4')).toBe(0)
    expect(compareVersions('1.2.3+build.5', '1.2.3')).toBe(0)
    expect(
      compareVersions('999999999999999999999.0.0', '1000000000000000000000.0.0')
    ).toBeLessThan(0)
  })

  it('validates release tags before they are cached or installed', () => {
    expect(isValidVersion('v2.0.0')).toBe(true)
    expect(isValidVersion('2.0.0-rc.1+build.3')).toBe(true)
    expect(isValidVersion('2.0')).toBe(false)
    expect(isValidVersion('2.0.0/other')).toBe(false)
  })
})

describe('throttle state', () => {
  beforeEach(() => {
    writeState({})
  })

  it('persists and reads back', () => {
    writeState({ lastCheck: 123, latestVersion: '9.9.9' })
    expect(readState()).toEqual({ lastCheck: 123, latestVersion: '9.9.9' })
  })

  it('recentlyChecked respects the 24h window', () => {
    expect(recentlyChecked()).toBe(false)
    writeState({ lastCheck: Date.now(), latestVersion: '9.9.9' })
    expect(recentlyChecked()).toBe(true)
    writeState({ lastCheck: Date.now() - CHECK_INTERVAL_MS - 1 })
    expect(recentlyChecked()).toBe(false)
  })

  it('corrupt state reads as empty instead of throwing', () => {
    writeFileSync(stateFile(), 'not json{{{')
    expect(readState()).toEqual({})
  })

  afterAll(() => {
    try {
      rmSync(stateFile(), { force: true })
    } catch {
      /* best effort */
    }
  })
})

describe('package-manager helpers', () => {
  it('accepts plain versions and ranges as re-installable specs', () => {
    expect(isSafeSpec('2.0.0')).toBe(true)
    expect(isSafeSpec('^1.0.0')).toBe(true)
    expect(isSafeSpec('~1.2.3')).toBe(true)
    expect(isSafeSpec('*')).toBe(true)
  })

  it('refuses git URLs, paths, and tags', () => {
    expect(isSafeSpec('github:arts009009009/Blazefire')).toBe(false)
    expect(isSafeSpec('file:../blazefire')).toBe(false)
    expect(isSafeSpec('canary')).toBe(false)
  })

  it('builds manager-specific update commands', () => {
    expect(updateCommand('npm', '2.1.0')).toEqual({
      command: 'npm',
      args: ['install', '-D', 'blazefire@2.1.0'],
    })
    expect(updateCommand('yarn', '2.1.0').args[0]).toBe('add')
    expect(updateCommand('pnpm', '2.1.0').command).toBe('pnpm')
    expect(updateCommand('bun', '2.1.0').args).toEqual(['add', '-d', 'blazefire@2.1.0'])
  })

  it('specTarget names the package', () => {
    expect(specTarget('2.1.0')).toBe('blazefire@2.1.0')
  })
})

describe('npm lockfile surgery', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bf-lock-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('removes blazefire entries at the root and nested paths', () => {
    const file = join(dir, 'package-lock.json')
    writeFileSync(
      file,
      JSON.stringify({
        packages: {
          '': { name: 'host' },
          'node_modules/blazefire': { version: '1.0.0' },
          'apps/web/node_modules/blazefire': { version: '1.0.0' },
          'node_modules/next': { version: '15.0.0' },
        },
      })
    )

    expect(removeNpmLockEntry(file)).toBe(true)
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    expect(parsed.packages['node_modules/blazefire']).toBeUndefined()
    expect(parsed.packages['apps/web/node_modules/blazefire']).toBeUndefined()
    expect(parsed.packages['node_modules/next']).toBeDefined()
  })

  it('returns false on a missing or corrupt lockfile', () => {
    expect(removeNpmLockEntry(join(dir, 'nope.json'))).toBe(false)
    const bad = join(dir, 'bad.json')
    writeFileSync(bad, '{{{')
    expect(removeNpmLockEntry(bad)).toBe(false)
  })

  it('purgeCachedInstall removes the node_modules entry (npm path)', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'bf-purge-'))
    try {
      writeFileSync(join(projectRoot, 'package.json'), '{"name":"host"}')
      const entry = join(projectRoot, 'node_modules', 'blazefire')
      writeFileSync(join(projectRoot, 'package-lock.json'), JSON.stringify({ packages: {} }))
      mkdirSync(entry, { recursive: true })
      writeFileSync(join(entry, 'package.json'), '{"name":"blazefire"}')

      const removed = purgeCachedInstall('npm', projectRoot)
      expect(removed).toContain(entry)
      expect(existsSync(entry)).toBe(false)
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
    }
  })
})
