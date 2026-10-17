/**
 * Real package-manager compatibility matrix — npm, pnpm, yarn, bun.
 *
 * Every scenario uses real `<pm> install` / `<pm> add` child processes against
 * a throwaway fixture whose deps are LOCAL ONLY (a packed blazefire tarball +
 * a stub `next` package), so the matrix runs offline and fast:
 *
 *   1. auto-activation via the package's own postinstall (`run()` engine)
 *   2. hook idempotency on a second install
 *   3. restore round-trip through the PM-linked bin
 *   4. explicit init through the bin
 *   5. `blazefire update` driving the PM's real add/install
 *   6. BLAZEFIRE_SKIP_AUTO respected through the PM's script runner
 *   7. pnpm 10's build-script policy (documented requirement)
 *
 * PMs that are not installed on this machine are skipped, not failed.
 */

'use strict'

const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const REPO = path.join(__dirname, '..')
const { MARKER, BACKUP_DIR, HOOK_COMMAND } = require('../blazefire/postinstall.cjs')

const CONFIG = `const nextConfig = { reactStrictMode: true }\nmodule.exports = nextConfig\n`

const MANAGERS = ['npm', 'pnpm', 'yarn', 'bun']

const INSTALL_ARGS = {
  npm: ['install', '--no-audit', '--no-fund', '--loglevel=error'],
  pnpm: ['install', '--reporter=append-only'],
  yarn: ['install', '--silent', '--non-interactive'],
  bun: ['install'],
}

const USER_AGENT = {
  npm: 'npm/9.2.0 node/v22',
  pnpm: 'pnpm/10.34.5 npm/? node/v22',
  yarn: 'yarn/1.22.22 npm/? node/v22',
  bun: 'bun/1.4.2',
}

const available = Object.fromEntries(
  MANAGERS.map((pm) => [
    pm,
    spawnSync(pm, ['--version'], { encoding: 'utf8', timeout: 20000 }).status === 0,
  ])
)

/* ------------------------------------------------------------------ *
 * workspace + fixtures
 * ------------------------------------------------------------------ */

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-pm-matrix-'))
const TARBALL = path.join(workdir, 'blazefire.tgz')
const NEXT_STUB = path.join(workdir, 'next-stub')

beforeAll(() => {
  // Pack the package exactly as it would publish.
  const packed = spawnSync(
    'npm',
    ['pack', '--ignore-scripts', '--pack-destination', workdir],
    { cwd: REPO, encoding: 'utf8', timeout: 60000 }
  )
  if (packed.status !== 0) {
    throw new Error('npm pack failed: ' + packed.stderr)
  }
  const tarballName = packed.stdout.trim().split('\n').pop()
  fs.renameSync(path.join(workdir, tarballName), TARBALL)

  // A local stand-in for `next` (the engine only checks it exists).
  fs.mkdirSync(NEXT_STUB, { recursive: true })
  fs.writeFileSync(
    path.join(NEXT_STUB, 'package.json'),
    JSON.stringify({ name: 'next', version: '16.0.0', main: 'index.js' })
  )
  fs.writeFileSync(path.join(NEXT_STUB, 'index.js'), 'module.exports = {}\n')
})

afterAll(() => {
  fs.rmSync(workdir, { recursive: true, force: true })
})

let fixtureCount = 0

/** A fresh app dir depending on the packed tarball + next stub (all local). */
function makeFixture({ pnpmAllowlist = false } = {}) {
  const dir = path.join(workdir, 'app-' + fixtureCount++)
  fs.mkdirSync(dir, { recursive: true })
  const packageJson = {
    name: 'fixture-app',
    version: '0.0.0',
    dependencies: {
      next: 'file:../next-stub',
      blazefire: 'file:../' + path.basename(TARBALL),
    },
  }
  if (pnpmAllowlist) {
    packageJson.pnpm = { onlyBuiltDependencies: ['blazefire'] }
  }
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(packageJson, null, 2)
  )
  fs.writeFileSync(path.join(dir, 'next.config.js'), CONFIG)
  return dir
}

function cleanEnv(patch = {}) {
  const env = { ...process.env, ...patch }
  delete env.INIT_CWD
  delete env.npm_config_local_prefix
  delete env.npm_lifecycle_event
  delete env.BLAZEFIRE_SKIP_AUTO
  env.npm_config_update_notifier = 'false'
  env.YARN_DISABLE_UPDATE_NOTIFIER = '1'
  return env
}

function pm(pmName, args, cwd, patch) {
  return spawnSync(pmName, args, {
    cwd,
    env: cleanEnv(patch),
    encoding: 'utf8',
    timeout: 180000,
  })
}

const read = (dir, name) => fs.readFileSync(path.join(dir, name), 'utf8')
const exists = (dir, name) => fs.existsSync(path.join(dir, name))
const bin = (dir) => path.join(dir, 'node_modules', '.bin', 'blazefire')

function blazefire(args, cwd, patch) {
  return spawnSync(bin(cwd), args, {
    cwd,
    env: cleanEnv(patch),
    encoding: 'utf8',
    timeout: 60000,
  })
}

/* ------------------------------------------------------------------ *
 * the matrix
 * ------------------------------------------------------------------ */

for (const pmName of MANAGERS) {
  const describePm = available[pmName] ? describe : describe.skip
  // pnpm 10 blocks dependency build scripts by default; the allowlist is the
  // documented way to opt blazefire in.
  const allowlist = pmName === 'pnpm'

  describePm(`${pmName} compatibility`, () => {
    jest.setTimeout(240000)

    let dir

    beforeAll(() => {
      dir = makeFixture({ pnpmAllowlist: allowlist })
    })

    it('install auto-activates the project and links the bin', () => {
      const res = pm(pmName, INSTALL_ARGS[pmName], dir)
      expect(res.status).toBe(0)

      const wired = read(dir, 'next.config.js')
      expect(wired).toContain(MARKER)
      expect(wired).toContain('reactStrictMode: true')
      expect(read(dir, path.join(BACKUP_DIR, 'next.config.js'))).toBe(CONFIG)
      expect(read(dir, '.gitignore')).toContain(BACKUP_DIR)

      const pkg = JSON.parse(read(dir, 'package.json'))
      expect(pkg.scripts.postinstall).toBe(HOOK_COMMAND)

      // The PM linked our bin into node_modules/.bin.
      expect(exists(dir, 'node_modules/.bin/blazefire')).toBe(true)
      expect(exists(dir, 'node_modules/blazefire/package.json')).toBe(true)

      const help = blazefire(['--help'], dir)
      expect(help.status).toBe(0)
      expect(help.stdout).toContain('npx blazefire init')
    })

    it('a second install is idempotent (hook says already, config untouched)', () => {
      const before = read(dir, 'next.config.js')
      const res = pm(pmName, INSTALL_ARGS[pmName], dir)
      expect(res.status).toBe(0)
      expect(read(dir, 'next.config.js')).toBe(before)
      expect(before.match(/blazefire\(/g)).toHaveLength(1)
    })

    it('restore through the bin round-trips; a second restore exits 1', () => {
      const first = blazefire(['restore'], dir)
      expect(first.status).toBe(0)
      expect(read(dir, 'next.config.js')).toBe(CONFIG)
      expect(exists(dir, BACKUP_DIR)).toBe(false)
      const pkg = JSON.parse(read(dir, 'package.json'))
      expect(pkg.scripts && pkg.scripts.postinstall).toBeUndefined()

      const second = blazefire(['restore'], dir)
      expect(second.status).toBe(1)
    })

    it('explicit init through the bin re-activates', () => {
      const res = blazefire(['init'], dir)
      expect(res.status).toBe(0)
      expect(read(dir, 'next.config.js')).toContain(MARKER)
      const pkg = JSON.parse(read(dir, 'package.json'))
      expect(pkg.scripts.postinstall).toBe(HOOK_COMMAND)
    })

    it(`\`blazefire update\` drives the real \`${pmName}\` install/add`, () => {
      const res = spawnSync(
        process.execPath,
        [path.join(REPO, 'blazefire', 'cli.cjs'), 'update'],
        {
          cwd: dir,
          env: cleanEnv({ npm_config_user_agent: USER_AGENT[pmName] }),
          encoding: 'utf8',
          timeout: 180000,
        }
      )
      expect(res.status).toBe(0)
      expect(res.stdout).toContain('blazefire: done.')
      // blazefire is (still) installed and the config was not touched.
      expect(exists(dir, 'node_modules/blazefire/package.json')).toBe(true)
      expect(read(dir, 'next.config.js')).toContain(MARKER)
    })

    it('BLAZEFIRE_SKIP_AUTO=1 blocks activation through the PM script runner', () => {
      const fresh = makeFixture({ pnpmAllowlist: allowlist })
      const res = pm(pmName, INSTALL_ARGS[pmName], fresh, {
        BLAZEFIRE_SKIP_AUTO: '1',
      })
      expect(res.status).toBe(0)
      expect(read(fresh, 'next.config.js')).toBe(CONFIG) // untouched
      const pkg = JSON.parse(read(fresh, 'package.json'))
      expect(pkg.scripts && pkg.scripts.postinstall).toBeUndefined()
    })
  })
}

// pnpm-specific: document/enforce the pnpm 10 build-script requirement.
if (available.pnpm) {
  describe('pnpm 10 build-script policy', () => {
    jest.setTimeout(240000)

    it('without onlyBuiltDependencies, the postinstall does NOT run (documented)', () => {
      const dir = makeFixture({ pnpmAllowlist: false })
      const res = pm('pnpm', INSTALL_ARGS.pnpm, dir)
      expect(res.status).toBe(0) // install succeeds…
      expect(read(dir, 'next.config.js')).toBe(CONFIG) // …but never activated
      const pkg = JSON.parse(read(dir, 'package.json'))
      expect(pkg.scripts && pkg.scripts.postinstall).toBeUndefined()
    })
  })
}

/* ------------------------------------------------------------------ *
 * command-level checks that are package-manager independent
 * ------------------------------------------------------------------ */

describe('blazefire check (live update feed)', () => {
  jest.setTimeout(60000)

  it('reports installed vs latest and exits 0', () => {
    const res = spawnSync(
      process.execPath,
      [path.join(REPO, 'blazefire', 'cli.cjs'), 'check'],
      { cwd: workdir, env: cleanEnv(), encoding: 'utf8', timeout: 30000 }
    )
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(
      /blazefire: installed v\d+\.\d+\.\d+, latest v|could not reach the update feed/
    )
  })

  it('the `outdated` alias behaves the same', () => {
    const res = spawnSync(
      process.execPath,
      [path.join(REPO, 'blazefire', 'cli.cjs'), 'outdated'],
      { cwd: workdir, env: cleanEnv(), encoding: 'utf8', timeout: 30000 }
    )
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(
      /blazefire: installed v\d+\.\d+\.\d+, latest v|could not reach the update feed/
    )
  })
})

describe('blazefire update failure propagation (real npm)', () => {
  jest.setTimeout(120000)

  it('a failing install surfaces as exit 1 with a message', () => {
    const dir = makeFixture()
    // Point the spec at a tarball that does not exist → npm exits non-zero.
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({
        name: 'fixture-app',
        version: '0.0.0',
        dependencies: { blazefire: 'file:../does-not-exist.tgz' },
      })
    )
    const res = spawnSync(
      process.execPath,
      [path.join(REPO, 'blazefire', 'cli.cjs'), 'update'],
      {
        cwd: dir,
        env: cleanEnv({ npm_config_user_agent: USER_AGENT.npm }),
        encoding: 'utf8',
        timeout: 120000,
      }
    )
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('blazefire: update failed (exit')
  })
})
