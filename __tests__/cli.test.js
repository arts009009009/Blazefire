/**
 * End-to-end tests for the `blazefire` CLI (`blazefire/cli.cjs`), spawned as
 * a real child process exactly like `npx blazefire init` runs it.
 *
 * Network-touching commands (`check`, `update`) are not exercised here —
 * their internals are unit-tested in update-check suites.
 * Tests for the `blazefire` CLI entry (`blazefire/cli.cjs`).
 *
 * The CLI is exercised as a real child process — that is the only way to
 * cover argv parsing, exit codes and stdout/stderr routing honestly.
 * Everything here is offline and side-effect free: `--version`, `--help`
 * and an unknown command touch neither the network nor the filesystem.
 */

'use strict'

const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const CLI = path.join(__dirname, '..', 'blazefire', 'cli.cjs')
const {
  MARKER,
  BACKUP_DIR,
  HOOK_COMMAND,
} = require('../blazefire/postinstall.cjs')

const created = []

function makeProject(config) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-cli-'))
  created.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'fixture',
      version: '0.0.0',
      dependencies: { next: '16.0.0', blazefire: '^1.0.9' },
    })
  )
  fs.mkdirSync(path.join(root, 'node_modules', 'next'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'node_modules', 'next', 'package.json'),
    '{"name":"next","version":"16.0.0"}'
  )
  fs.writeFileSync(path.join(root, 'next.config.js'), config)
  return root
}

/** Run the CLI with an env where cwd alone decides the target. */
function cli(args, cwd) {
  const env = { ...process.env }
  delete env.INIT_CWD
  delete env.npm_config_local_prefix
  delete env.BLAZEFIRE_SKIP_AUTO
  delete env.npm_lifecycle_event
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 30000,
  })
}

const CONFIG = `const nextConfig = { reactStrictMode: true }\nmodule.exports = nextConfig\n`

afterEach(() => {
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('blazefire --help', () => {
  it('prints usage and exits 0', () => {
    const res = cli(['--help'], os.tmpdir())
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('npx blazefire init')
    expect(res.stdout).toContain('npx blazefire restore')
    expect(res.stdout).toContain('BLAZEFIRE_SKIP_AUTO=1')
    expect(res.stdout).toContain('BLAZEFIRE_SKIP_UPDATE_CHECK=1')
  })
})

describe('blazefire <unknown>', () => {
  it('fails with a helpful message', () => {
    const res = cli(['frobnicate'], os.tmpdir())
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('blazefire: unknown command "frobnicate"')
    expect(res.stderr).toContain('npx blazefire init')
  })
})

describe('blazefire init / restore', () => {
  it('wires the config and exits 0', () => {
    const root = makeProject(CONFIG)
    const res = cli(['init'], root)
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('activated')

    const wired = fs.readFileSync(path.join(root, 'next.config.js'), 'utf8')
    expect(wired).toContain(MARKER)
    expect(fs.existsSync(path.join(root, BACKUP_DIR, 'next.config.js'))).toBe(
      true
    )
    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, 'package.json'), 'utf8')
    )
    expect(pkg.scripts.postinstall).toBe(HOOK_COMMAND)
  })

  it('is idempotent (second init says already active, exit 0)', () => {
    const root = makeProject(CONFIG)
    cli(['init'], root)
    const before = fs.readFileSync(path.join(root, 'next.config.js'), 'utf8')
    const res = cli(['init'], root)
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('already active')
    expect(fs.readFileSync(path.join(root, 'next.config.js'), 'utf8')).toBe(
      before
    )
  })

  it('restore puts the original back and removes the hook', () => {
    const root = makeProject(CONFIG)
    cli(['init'], root)
    const res = cli(['restore'], root)
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('restored')
    expect(fs.readFileSync(path.join(root, 'next.config.js'), 'utf8')).toBe(
      CONFIG
    )
    expect(fs.existsSync(path.join(root, BACKUP_DIR))).toBe(false)
    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, 'package.json'), 'utf8')
    )
    expect(pkg.scripts && pkg.scripts.postinstall).toBeUndefined()
  })

  it('restore with nothing to restore exits 1', () => {
    const root = makeProject(CONFIG)
    const res = cli(['restore'], root)
    expect(res.status).toBe(1)
    expect(res.stdout).toContain('nothing to restore')
  })

  it('init in a directory with no Next project exits 1', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-cli-empty-'))
    created.push(dir)
    const res = cli(['init'], dir)
    expect(res.status).toBe(1)
    expect(res.stdout).toContain('no next.config.* found')
  })

  it('defaults to init with no arguments', () => {
    const root = makeProject(CONFIG)
    const res = cli([], root)
    expect(res.status).toBe(0)
    expect(
      fs.readFileSync(path.join(root, 'next.config.js'), 'utf8')
    ).toContain(MARKER)
  })

  it('honours BLAZEFIRE_SKIP_AUTO=1 for the automatic hook', () => {
    const root = makeProject(CONFIG)
    const env = { ...process.env }
    delete env.INIT_CWD
    delete env.npm_config_local_prefix
    env.BLAZEFIRE_SKIP_AUTO = '1'
    // Running as the lifecycle hook (as the written hook would) — must skip.
    env.npm_lifecycle_event = 'postinstall'
    // …but for isLifecycleHook() the hook must be in package.json, and here
    // nothing has run yet: with no hook present this is just an explicit init,
    // which the flag still allows — the config activates, the hook does not.
    const res = spawnSync(process.execPath, [CLI, 'init'], {
      cwd: root,
      env,
      encoding: 'utf8',
      timeout: 30000,
    })
    expect(res.status).toBe(0)
    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, 'package.json'), 'utf8')
    )
    expect(pkg.scripts && pkg.scripts.postinstall).toBeUndefined()
  })
})

describe('CLI output conventions', () => {
  it('prefixes messages with "blazefire:"', () => {
    const root = makeProject(CONFIG)
    const res = cli(['init'], root)
    expect(res.stdout).toMatch(/^\s*blazefire: /m)
const { execFileSync } = require('child_process')
const path = require('path')

const CLI = path.join(__dirname, '..', 'blazefire', 'cli.cjs')
const VERSION = require('../package.json').version

/** Run the CLI with the given argv, never throwing on non-zero exits. */
function run(args) {
  try {
    return {
      status: 0,
      stdout: execFileSync('node', [CLI].concat(args), { encoding: 'utf8' }),
      stderr: '',
    }
  } catch (error) {
    return {
      status: error.status,
      stdout: error.stdout || '',
      stderr: error.stderr || '',
    }
  }
}

describe('blazefire CLI version reporting', () => {
  test.each([['--version'], ['-v'], ['version']])(
    'blazefire %s prints the installed version',
    (arg) => {
      const { status, stdout } = run([arg])
      expect(status).toBe(0)
      expect(stdout.trim()).toBe('blazefire v' + VERSION)
    }
  )

  test('an unknown command fails and names the installed version', () => {
    const { status, stderr } = run(['frobnicate'])
    expect(status).toBe(1)
    expect(stderr).toContain('unknown command "frobnicate"')
    // Naming the version turns "this command does not exist" into the far
    // more useful "my installed copy predates this command".
    expect(stderr).toContain('v' + VERSION)
  })

  test('--help lists every command including --version', () => {
    const { status, stdout } = run(['--help'])
    expect(status).toBe(0)
    for (const command of [
      'npx blazefire init',
      'npx blazefire restore',
      'npx blazefire update',
      'npx blazefire check',
      'npx blazefire --version',
    ]) {
      expect(stdout).toContain(command)
    }
  })
})
