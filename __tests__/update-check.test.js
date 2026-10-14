/**
 * Tests for the `blazefire update` / `blazefire check` engine
 * (`blazefire/update-check.cjs`).
 *
 * Everything here is offline and deterministic: the network call, the child
 * process and the interactive prompt are all stubbed. What is exercised for
 * real is the logic those wrap — version comparison, throttling, package
 * manager detection and command construction.
 */

'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const updates = require('../blazefire/update-check.cjs')

const { CHECK_INTERVAL_MS, compareVersions } = updates

/** A scratch dir that is torn down after each test. */
let scratch

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'blazefire-test-'))
})

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true })
})

function writePackageJson(dir, pkg) {
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg))
  return dir
}

describe('compareVersions', () => {
  test('orders plain release numbers', () => {
    expect(compareVersions('1.0.2', '1.0.0')).toBe(1)
    expect(compareVersions('1.0.0', '1.0.2')).toBe(-1)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
  })

  test('compares each component independently', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1)
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1)
    expect(compareVersions('1.1.9', '1.1.10')).toBe(-1)
  })

  test('tolerates a leading v', () => {
    expect(compareVersions('v1.0.3', '1.0.0')).toBe(1)
    expect(compareVersions('V1.0.0', 'v1.0.0')).toBe(0)
  })

  test('ranks a prerelease below its own release', () => {
    // The repo really does carry this tag; it must never out-rank 1.0.1.
    expect(compareVersions('v1.0.1-blazefire-pnpm', '1.0.1')).toBe(-1)
    expect(compareVersions('1.0.1', 'v1.0.1-blazefire-pnpm')).toBe(1)
    expect(compareVersions('v1.0.1-blazefire-pnpm', 'v1.0.1-blazefire-pnpm')).toBe(0)
  })

  test('a prerelease still beats the older release', () => {
    expect(compareVersions('v1.0.1-blazefire-pnpm', '1.0.0')).toBe(1)
  })

  test('garbage compares equal rather than throwing', () => {
    expect(compareVersions('not-a-version', '1.0.0')).toBe(0)
    expect(compareVersions(null, undefined)).toBe(0)
    expect(compareVersions('', '')).toBe(0)
  })
})

describe('getRepoSlug', () => {
  test('derives owner/repo from the repository.url field', () => {
    expect(updates.getRepoSlug()).toBe('arts009009009/Blazefire')
  })
})

describe('getInstalledVersion', () => {
  test('reads the version this package is shipped as', () => {
    const pkg = require('../package.json')
    expect(updates.getInstalledVersion()).toBe(pkg.version)
  })
})

describe('throttle state', () => {
  test('never writes into the project — the state file lives in the temp dir', () => {
    const file = updates.stateFile(scratch)
    expect(path.dirname(file)).toBe(os.tmpdir())
    expect(fs.existsSync(file)).toBe(false)
  })

  test('different projects get different state files', () => {
    expect(updates.stateFile('/a/one')).not.toBe(updates.stateFile('/a/two'))
  })

  test('the same project always maps to the same state file', () => {
    expect(updates.stateFile('/a/one')).toBe(updates.stateFile('/a/one'))
  })

  test('a fresh project has not been checked', () => {
    expect(updates.recentlyChecked(scratch, Date.now())).toBe(false)
    expect(updates.readState(scratch)).toEqual({})
  })

  test('asks again only after the window has elapsed', () => {
    const now = 1_000_000_000_000
    updates.writeState(scratch, { lastCheck: now })

    // Immediately after: silent.
    expect(updates.recentlyChecked(scratch, now)).toBe(true)
    expect(updates.recentlyChecked(scratch, now + 1000)).toBe(true)

    // Just inside the window: still silent.
    expect(updates.recentlyChecked(scratch, now + CHECK_INTERVAL_MS - 1)).toBe(
      true
    )

    // At (and after) the boundary: allowed to ask again.
    expect(updates.recentlyChecked(scratch, now + CHECK_INTERVAL_MS)).toBe(false)
    expect(updates.recentlyChecked(scratch, now + CHECK_INTERVAL_MS + 1)).toBe(
      false
    )
  })

  test('the window is a rolling gap, so it is timezone-independent', () => {
    // Whatever the wall clock says, only elapsed time matters — a check made
    // "yesterday at 23:00" suppresses one "today at 01:00".
    const lateNight = Date.UTC(2026, 9, 13, 23, 0)
    const earlyMorning = Date.UTC(2026, 9, 14, 1, 0)
    updates.writeState(scratch, { lastCheck: lateNight })
    expect(updates.recentlyChecked(scratch, earlyMorning)).toBe(true)
  })

  test('writeState merges rather than replaces', () => {
    updates.writeState(scratch, { lastCheck: 123 })
    updates.writeState(scratch, { other: 'kept' })
    const state = updates.readState(scratch)
    expect(state.lastCheck).toBe(123)
    expect(state.other).toBe('kept')
  })

  test('survives a corrupt state file', () => {
    fs.writeFileSync(updates.stateFile(scratch), '{not json')
    expect(updates.readState(scratch)).toEqual({})
    expect(updates.recentlyChecked(scratch, Date.now())).toBe(false)
  })
})

describe('detectPackageManager', () => {
  const ORIGINAL_UA = process.env.npm_config_user_agent

  afterEach(() => {
    if (ORIGINAL_UA === undefined) delete process.env.npm_config_user_agent
    else process.env.npm_config_user_agent = ORIGINAL_UA
  })

  test('trusts the user-agent the package manager sets', () => {
    process.env.npm_config_user_agent = 'pnpm/9.0.0 npm/? node/v20.0.0 linux x64'
    expect(updates.detectPackageManager(scratch)).toBe('pnpm')

    process.env.npm_config_user_agent = 'yarn/1.22.19 npm/? node/v20.0.0'
    expect(updates.detectPackageManager(scratch)).toBe('yarn')

    process.env.npm_config_user_agent = 'bun/1.0.0'
    expect(updates.detectPackageManager(scratch)).toBe('bun')

    process.env.npm_config_user_agent = 'npm/10.0.0 node/v20.0.0 linux x64'
    expect(updates.detectPackageManager(scratch)).toBe('npm')
  })

  test('falls back to lockfiles when no user-agent is present', () => {
    delete process.env.npm_config_user_agent

    fs.writeFileSync(path.join(scratch, 'pnpm-lock.yaml'), '')
    expect(updates.detectPackageManager(scratch)).toBe('pnpm')

    fs.rmSync(path.join(scratch, 'pnpm-lock.yaml'))
    fs.writeFileSync(path.join(scratch, 'yarn.lock'), '')
    expect(updates.detectPackageManager(scratch)).toBe('yarn')

    fs.rmSync(path.join(scratch, 'yarn.lock'))
    fs.writeFileSync(path.join(scratch, 'bun.lockb'), '')
    expect(updates.detectPackageManager(scratch)).toBe('bun')
  })

  test('defaults to npm with nothing to go on', () => {
    delete process.env.npm_config_user_agent
    expect(updates.detectPackageManager(scratch)).toBe('npm')
  })
})

describe('readInstalledSpec', () => {
  test('reads the exact specifier the user installed with', () => {
    writePackageJson(scratch, {
      dependencies: { blazefire: 'github:arts009009009/Blazefire#my-branch' },
    })
    expect(updates.readInstalledSpec(scratch)).toBe(
      'github:arts009009009/Blazefire#my-branch'
    )
  })

  test('finds it in devDependencies too', () => {
    writePackageJson(scratch, {
      devDependencies: { blazefire: 'https://example.com/blazefire.tgz' },
    })
    expect(updates.readInstalledSpec(scratch)).toBe(
      'https://example.com/blazefire.tgz'
    )
  })

  test('falls back to the canonical github spec when undeclared', () => {
    writePackageJson(scratch, { name: 'app', dependencies: { next: '16.0.0' } })
    expect(updates.readInstalledSpec(scratch)).toBe(
      'github:arts009009009/Blazefire'
    )
  })

  test('falls back when there is no package.json at all', () => {
    expect(updates.readInstalledSpec(scratch)).toBe(
      'github:arts009009009/Blazefire'
    )
  })
})

describe('updateCommand', () => {
  beforeEach(() => {
    writePackageJson(scratch, {
      dependencies: { blazefire: 'github:arts009009009/Blazefire' },
    })
  })

  test('uses each manager add/install form', () => {
    const spec = 'github:arts009009009/Blazefire'

    expect(updates.updateCommand(scratch, 'npm')).toEqual({
      command: 'npm',
      args: ['install', spec],
    })
    expect(updates.updateCommand(scratch, 'yarn')).toEqual({
      command: 'yarn',
      args: ['add', spec],
    })
    expect(updates.updateCommand(scratch, 'pnpm')).toEqual({
      command: 'pnpm',
      args: ['add', spec],
    })
    expect(updates.updateCommand(scratch, 'bun')).toEqual({
      command: 'bun',
      args: ['add', spec],
    })
  })

  test('re-uses the user-specified ref so a pinned branch stays pinned', () => {
    writePackageJson(scratch, {
      dependencies: { blazefire: 'github:arts009009009/Blazefire#release' },
    })
    const cmd = updates.updateCommand(scratch, 'npm')
    expect(cmd.args).toEqual([
      'install',
      'github:arts009009009/Blazefire#release',
    ])
  })
})

describe('shouldNotify', () => {
  const ORIGINAL_ENV = {
    CI: process.env.CI,
    SKIP: process.env.BLAZEFIRE_SKIP_UPDATE_CHECK,
    TTY: process.stdout.isTTY,
  }

  afterEach(() => {
    for (const [key, value] of [
      ['CI', ORIGINAL_ENV.CI],
      ['BLAZEFIRE_SKIP_UPDATE_CHECK', ORIGINAL_ENV.SKIP],
    ]) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    Object.defineProperty(process.stdout, 'isTTY', {
      value: ORIGINAL_ENV.TTY,
      configurable: true,
      writable: true,
    })
  })

  function setArgv(argv) {
    process.argv = ['node', 'next', ...argv]
  }

  test('fires for an interactive next dev', () => {
    delete process.env.CI
    delete process.env.BLAZEFIRE_SKIP_UPDATE_CHECK
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      configurable: true,
      writable: true,
    })
    setArgv(['dev'])
    expect(updates.shouldNotify()).toBe(true)
  })

  test('stays silent for build and start', () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      configurable: true,
      writable: true,
    })
    setArgv(['build'])
    expect(updates.shouldNotify()).toBe(false)

    setArgv(['start'])
    expect(updates.shouldNotify()).toBe(false)
  })

  test('stays silent when stdout is not a terminal', () => {
    delete process.env.CI
    Object.defineProperty(process.stdout, 'isTTY', {
      value: false,
      configurable: true,
      writable: true,
    })
    setArgv(['dev'])
    expect(updates.shouldNotify()).toBe(false)
  })

  test('stays silent in CI', () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      configurable: true,
      writable: true,
    })
    process.env.CI = '1'
    setArgv(['dev'])
    expect(updates.shouldNotify()).toBe(false)
  })

  test('honours the opt-out env var', () => {
    delete process.env.CI
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      configurable: true,
      writable: true,
    })
    process.env.BLAZEFIRE_SKIP_UPDATE_CHECK = '1'
    setArgv(['dev'])
    expect(updates.shouldNotify()).toBe(false)
  })
})

describe('promptYesNo', () => {
  test('declines without a terminal rather than hanging', () => {
    const originalIsTTY = process.stdin.isTTY
    Object.defineProperty(process.stdin, 'isTTY', {
      value: false,
      configurable: true,
      writable: true,
    })

    let answered = null
    updates.promptYesNo('q? ', (a) => {
      answered = a
    })

    Object.defineProperty(process.stdin, 'isTTY', {
      value: originalIsTTY,
      configurable: true,
      writable: true,
    })
    expect(answered).toBe(false)
  })
})

describe('checkForUpdate', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  function fakeResponse(body, ok = true) {
    return {
      ok,
      json: async () => body,
    }
  }

  test('reports an available update', async () => {
    global.fetch = async () => fakeResponse({ tag_name: 'v9.9.9' })
    const info = await updates.checkForUpdate()
    expect(info.updateAvailable).toBe(true)
    expect(info.latest).toBe('v9.9.9')
    expect(info.current).toBe(require('../package.json').version)
  })

  test('reports up-to-date when the release matches', async () => {
    const current = require('../package.json').version
    global.fetch = async () => fakeResponse({ tag_name: current })
    const info = await updates.checkForUpdate()
    expect(info.updateAvailable).toBe(false)
  })

  test('treats a prerelease of our own version as not newer', async () => {
    const current = require('../package.json').version
    global.fetch = async () => fakeResponse({ tag_name: current + '-rc.1' })
    const info = await updates.checkForUpdate()
    expect(info.updateAvailable).toBe(false)
  })

  test('returns null when the feed is unreachable', async () => {
    global.fetch = async () => {
      throw new Error('network down')
    }
    expect(await updates.checkForUpdate()).toBe(null)
  })

  test('returns null on a non-2xx response', async () => {
    global.fetch = async () => fakeResponse({}, false)
    expect(await updates.checkForUpdate()).toBe(null)
  })

  test('never throws, whatever fetch does', async () => {
    global.fetch = undefined
    await expect(updates.checkForUpdate()).resolves.not.toThrow()
  })
})
