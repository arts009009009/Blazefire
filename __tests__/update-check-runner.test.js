/**
 * Tests for the parts of `blazefire/update-check.cjs` that drive real
 * behaviour: the dev-time notifier (`maybeNotify`), the network fetch
 * (`fetchLatestVersion` / `checkForUpdate`) and the child-process updater
 * (`runUpdate`).
 *
 * No test here touches the network or a real package manager: `fetch` is
 * mocked and a fake `npm`/`pnpm` is placed first on PATH.
 */

'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const upd = require('../blazefire/update-check.cjs')
const pkg = require('../package.json')

/** Let maybeNotify's detached promise chain settle. */
const flush = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms))

/* ------------------------------------------------------------------ *
 * fetchLatestVersion / checkForUpdate
 * ------------------------------------------------------------------ */

describe('fetchLatestVersion', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('requests this repo’s releases and returns the tag', async () => {
    let requestedUrl
    global.fetch = jest.fn(async (url) => {
      requestedUrl = url
      return { ok: true, json: async () => ({ tag_name: 'v2.3.4' }) }
    })
    await expect(upd.fetchLatestVersion()).resolves.toBe('v2.3.4')
    expect(requestedUrl).toContain(
      'https://api.github.com/repos/' + upd.getRepoSlug() + '/releases/latest'
    )
  })

  it('returns null on a non-ok response (rate limit, 404)', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 404 }))
    await expect(upd.fetchLatestVersion()).resolves.toBeNull()
  })

  it('returns null when the request throws (offline, timeout)', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('network down')
    })
    await expect(upd.fetchLatestVersion()).resolves.toBeNull()
  })

  it('returns null when the payload has no tag_name', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ name: 'no tag here' }),
    }))
    await expect(upd.fetchLatestVersion()).resolves.toBeNull()
  })

  it('returns null without throwing when fetch is unavailable', async () => {
    delete global.fetch
    await expect(upd.fetchLatestVersion()).resolves.toBeNull()
  })
})

describe('checkForUpdate', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('reports an update when the release tag is newer', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ tag_name: 'v99.0.0' }),
    }))
    const info = await upd.checkForUpdate()
    expect(info.current).toBe(pkg.version)
    expect(info.latest).toBe('v99.0.0')
    expect(info.updateAvailable).toBe(true)
  })

  it('reports no update for the installed tag', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ tag_name: 'v' + pkg.version }),
    }))
    const info = await upd.checkForUpdate()
    expect(info.updateAvailable).toBe(false)
  })

  it('returns null when the fetch fails', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('nope')
    })
    await expect(upd.checkForUpdate()).resolves.toBeNull()
  })
})

/* ------------------------------------------------------------------ *
 * maybeNotify (the `next dev` offer)
 * ------------------------------------------------------------------ */

describe('maybeNotify', () => {
  const statePath = upd.stateFile(process.cwd())
  const originalFetch = global.fetch
  const originalArgv = process.argv
  const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')

  function setTTY(value) {
    Object.defineProperty(process.stdout, 'isTTY', {
      value,
      configurable: true,
    })
  }

  function eligibleForPrompt() {
    setTTY(true)
    process.argv = ['node', 'next', 'dist/bin/next', 'dev']
    delete process.env.CI
    delete process.env.BLAZEFIRE_SKIP_UPDATE_CHECK
  }

  beforeEach(() => {
    fs.rmSync(statePath, { force: true })
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ tag_name: 'v99.0.0' }),
    }))
  })

  afterEach(() => {
    process.argv = originalArgv
    if (ttyDescriptor)
      Object.defineProperty(process.stdout, 'isTTY', ttyDescriptor)
    else delete process.stdout.isTTY
    global.fetch = originalFetch
    delete process.env.CI
    delete process.env.BLAZEFIRE_SKIP_UPDATE_CHECK
    fs.rmSync(statePath, { force: true })
  })

  it('stays silent when stdout is not a TTY (CI logs, piped output)', async () => {
    setTTY(false)
    process.argv = ['node', 'next', 'dist/bin/next', 'dev']
    maybeNotifyAndFlush()
    expect(global.fetch).not.toHaveBeenCalled()
    expect(fs.existsSync(statePath)).toBe(false)
  })

  it('stays silent in CI', async () => {
    eligibleForPrompt()
    process.env.CI = 'true'
    maybeNotifyAndFlush()
    expect(global.fetch).not.toHaveBeenCalled()
    expect(fs.existsSync(statePath)).toBe(false)
  })

  it('stays silent when BLAZEFIRE_SKIP_UPDATE_CHECK is set', async () => {
    eligibleForPrompt()
    process.env.BLAZEFIRE_SKIP_UPDATE_CHECK = '1'
    maybeNotifyAndFlush()
    expect(global.fetch).not.toHaveBeenCalled()
    expect(fs.existsSync(statePath)).toBe(false)
  })

  it('stays silent outside `next dev`', async () => {
    eligibleForPrompt()
    process.argv = ['node', 'next', 'dist/bin/next', 'build']
    maybeNotifyAndFlush()
    expect(global.fetch).not.toHaveBeenCalled()
    expect(fs.existsSync(statePath)).toBe(false)
  })

  it('checks once and stamps the 24h window when eligible', async () => {
    eligibleForPrompt()
    maybeNotifyAndFlush(50)

    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(fs.existsSync(statePath)).toBe(true)
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    expect(Date.now() - state.lastCheck).toBeLessThan(60_000)
  })

  it('does not fetch again inside the window', async () => {
    eligibleForPrompt()
    upd.writeState(process.cwd(), { lastCheck: Date.now() })
    maybeNotifyAndFlush()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  function maybeNotifyAndFlush(ms) {
    upd.maybeNotify()
    // detached .then chain — flush synchronously-queued microtasks here; the
    // promise body runs after the assertion only if it was scheduled at all,
    // so tests that expect "not called" are safe either way.
    return flush(ms)
  }
})

/* ------------------------------------------------------------------ *
 * runUpdate (child-process updater)
 * ------------------------------------------------------------------ */

describe('runUpdate', () => {
  const originalPath = process.env.PATH
  const originalUserAgent = process.env.npm_config_user_agent
  const created = []

  function fakePackageManager(name, exitCode) {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-bin-'))
    created.push(bin)
    const log = path.join(bin, 'invocation.log')
    const script = `#!/bin/sh\necho "$@" >> "${log}"\nexit ${exitCode}\n`
    fs.writeFileSync(path.join(bin, name), script, { mode: 0o755 })
    return { bin, log }
  }

  function fixtureProject() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-upd-'))
    created.push(root)
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        dependencies: { blazefire: 'github:arts009009009/Blazefire' },
      })
    )
    return root
  }

  function runUpdateAsync(root) {
    return new Promise((resolve) => {
      upd.runUpdate(root, (code) => resolve(code))
    })
  }

  afterEach(() => {
    process.env.PATH = originalPath
    if (originalUserAgent === undefined)
      delete process.env.npm_config_user_agent
    else process.env.npm_config_user_agent = originalUserAgent
    for (const dir of created.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('runs `npm install <spec>` and propagates a non-zero exit code', async () => {
    const { bin, log } = fakePackageManager('npm', 7)
    process.env.PATH = bin + path.delimiter + originalPath
    delete process.env.npm_config_user_agent

    const root = fixtureProject()
    const code = await runUpdateAsync(root)

    expect(code).toBe(7)
    const args = fs.readFileSync(log, 'utf8').trim()
    expect(args).toBe('install github:arts009009009/Blazefire')
  })

  it('runs `pnpm add <spec>` when the user agent says pnpm', async () => {
    const { bin, log } = fakePackageManager('pnpm', 0)
    process.env.PATH = bin + path.delimiter + originalPath
    process.env.npm_config_user_agent = 'pnpm/9.0.0 npm/? node/v22'

    const root = fixtureProject()
    const code = await runUpdateAsync(root)

    expect(code).toBe(0)
    const args = fs.readFileSync(log, 'utf8').trim()
    expect(args).toBe('add github:arts009009009/Blazefire')
  })
})
