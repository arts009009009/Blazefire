/**
 * End-to-end lifecycle tests for `blazefire/postinstall.cjs` — the engine
 * behind both the automatic postinstall and `npx blazefire init` / `restore`.
 *
 * These drive `run()` / `restore()` against throwaway projects in the OS temp
 * dir (exactly what the CLI invokes), rather than the pure `rewrite()`/`plan()`
 * unit tests in postinstall.test.js.
 */

'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  run,
  restore,
  MARKER,
  BACKUP_DIR,
  HOOK_COMMAND,
} = require('../blazefire/postinstall.cjs')

const REPO_ROOT = path.join(__dirname, '..')
const HOOK_RECORD = 'scripts.postinstall.json'

const created = []

/** Build a throwaway project; returns its root. */
function makeProject({
  config,
  configName = 'next.config.js',
  deps,
  nextInstalled = true,
}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-life-'))
  created.push(root)

  const packageJson = {
    name: 'fixture',
    version: '0.0.0',
    dependencies: deps || { next: '16.0.0', blazefire: '^1.1.2' },
  }
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify(packageJson, null, 2)
  )
  if (nextInstalled) {
    fs.mkdirSync(path.join(root, 'node_modules', 'next'), { recursive: true })
    fs.writeFileSync(
      path.join(root, 'node_modules', 'next', 'package.json'),
      JSON.stringify({ name: 'next', version: '16.0.0' })
    )
  }
  if (config !== undefined) {
    fs.writeFileSync(path.join(root, configName), config)
  }
  return root
}

const read = (root, name) => fs.readFileSync(path.join(root, name), 'utf8')
const exists = (root, name) => fs.existsSync(path.join(root, name))

/** Point the candidate search at `dir` for the duration of a test. */
function targeting(dir) {
  process.env.INIT_CWD = dir
  delete process.env.npm_config_local_prefix
}

const CJS_CONFIG = `const nextConfig = { reactStrictMode: true }\nmodule.exports = nextConfig\n`
const ESM_CONFIG = `const nextConfig = { reactStrictMode: true }\nexport default nextConfig\n`

beforeEach(() => {
  delete process.env.BLAZEFIRE_SKIP_AUTO
  delete process.env.npm_lifecycle_event
})

afterEach(() => {
  delete process.env.BLAZEFIRE_SKIP_AUTO
  delete process.env.INIT_CWD
  delete process.env.npm_lifecycle_event
  delete process.env.npm_config_local_prefix
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('init lifecycle (run)', () => {
  it('activates a CJS config: wraps, backs up, ignores, hooks', () => {
    const root = makeProject({ config: CJS_CONFIG })
    targeting(root)

    expect(run({ cli: true })).toBe('activated')

    const wired = read(root, 'next.config.js')
    expect(wired).toContain(MARKER)
    expect(wired).toContain('require("blazefire/plugin")')
    expect(wired).toContain('blazefire(nextConfig)')
    expect(wired).toContain('reactStrictMode: true') // original content kept

    expect(read(root, path.join(BACKUP_DIR, 'next.config.js'))).toBe(CJS_CONFIG)
    expect(read(root, '.gitignore')).toContain(BACKUP_DIR)
    expect(exists(root, path.join(BACKUP_DIR, HOOK_RECORD))).toBe(true)

    const pkg = JSON.parse(read(root, 'package.json'))
    expect(pkg.scripts.postinstall).toBe(HOOK_COMMAND)
  })

  it('activates an ESM config with the import form', () => {
    const root = makeProject({ config: ESM_CONFIG })
    targeting(root)
    expect(run({ cli: true })).toBe('activated')
    const wired = read(root, 'next.config.js')
    expect(wired).toContain('import blazefire from "blazefire/plugin";')
    expect(wired).toContain('export default blazefire(nextConfig)')
  })

  it('is idempotent — a second run reports already and writes nothing', () => {
    const root = makeProject({ config: CJS_CONFIG })
    targeting(root)
    expect(run({ cli: true })).toBe('activated')
    const first = read(root, 'next.config.js')
    expect(run({ cli: true })).toBe('already')
    expect(read(root, 'next.config.js')).toBe(first)
    expect(first.match(/blazefire\(/g)).toHaveLength(1)
  })

  it('the automatic (non-CLI) path activates an installed project too', () => {
    const root = makeProject({ config: CJS_CONFIG })
    targeting(root)
    expect(run()).toBe('activated')
  })

  it('cli activates a project that only DECLARES next (not installed yet)', () => {
    const root = makeProject({
      config: CJS_CONFIG,
      nextInstalled: false,
      deps: { next: '16.0.0', blazefire: '^1.1.2' },
    })
    targeting(root)
    expect(run({ cli: true })).toBe('activated')
  })

  it('the automatic path waits when next is absent, but still writes the hook', () => {
    const root = makeProject({
      config: CJS_CONFIG,
      nextInstalled: false,
      deps: { next: '16.0.0', blazefire: '^1.1.2' },
    })
    targeting(root)
    expect(run()).toBe('manual')
    expect(read(root, 'next.config.js')).toBe(CJS_CONFIG) // untouched
    const pkg = JSON.parse(read(root, 'package.json'))
    expect(pkg.scripts.postinstall).toBe(HOOK_COMMAND) // next install will finish
  })

  it('reports manual for a Next project with no config at all', () => {
    const root = makeProject({ config: undefined })
    targeting(root)
    expect(run({ cli: true })).toBe('manual')
  })

  it('reports not-found when there is nothing to do', () => {
    const root = makeProject({
      config: undefined,
      deps: { lodash: '^4.0.0' },
      nextInstalled: false,
    })
    targeting(root)
    expect(run({ cli: true })).toBe('not-found')
  })

  it('never edits its own package (ownRoot guard)', () => {
    targeting(REPO_ROOT)
    expect(run({ cli: true })).toBe('not-found')
    const pkg = JSON.parse(read(REPO_ROOT, 'package.json'))
    expect(pkg.scripts.postinstall).toBe('node blazefire/postinstall.cjs')
  })
})

describe('BLAZEFIRE_SKIP_AUTO', () => {
  it('blocks the automatic path entirely', () => {
    const root = makeProject({ config: CJS_CONFIG })
    targeting(root)
    process.env.BLAZEFIRE_SKIP_AUTO = '1'
    expect(run()).toBe('not-found')
    expect(read(root, 'next.config.js')).toBe(CJS_CONFIG)
    const pkg = JSON.parse(read(root, 'package.json'))
    expect(pkg.scripts).toBeUndefined() // no hook either
  })

  it('honours an explicit CLI init for the hook, but still activates', () => {
    // The docs say an explicit `npx blazefire init` is a user decision —
    // activation proceeds — but no hook may be written while the flag is set.
    const root = makeProject({ config: CJS_CONFIG })
    targeting(root)
    process.env.BLAZEFIRE_SKIP_AUTO = '1'
    expect(run({ cli: true })).toBe('activated')
    expect(read(root, 'next.config.js')).toContain(MARKER)
    const pkg = JSON.parse(read(root, 'package.json'))
    expect(pkg.scripts && pkg.scripts.postinstall).toBeUndefined()
  })

  it('blocks the CLI hook while the project is running as the lifecycle hook', () => {
    const root = makeProject({ config: CJS_CONFIG })
    // The hook must already be in package.json for isLifecycleHook() to
    // recognise this invocation as "our own written hook".
    const pkgPath = path.join(root, 'package.json')
    const pkg = JSON.parse(read(root, 'package.json'))
    pkg.scripts = { postinstall: HOOK_COMMAND }
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))

    targeting(root)
    process.env.BLAZEFIRE_SKIP_AUTO = '1'
    process.env.npm_lifecycle_event = 'postinstall'
    expect(run({ cli: true })).toBe('not-found')
    expect(read(root, 'next.config.js')).toBe(CJS_CONFIG)
  })
})

describe('monorepo (workspace) activation', () => {
  function makeMonorepo() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-mono-'))
    created.push(root)
    const app = path.join(root, 'apps', 'web')
    fs.mkdirSync(app, { recursive: true })

    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: 'mono',
        private: true,
        workspaces: ['apps/*'],
        dependencies: { next: '16.0.0', blazefire: '^1.1.2' },
      })
    )
    fs.writeFileSync(
      path.join(app, 'package.json'),
      JSON.stringify({ name: 'web', dependencies: { next: '16.0.0' } })
    )
    fs.mkdirSync(path.join(app, 'node_modules', 'next'), { recursive: true })
    fs.writeFileSync(
      path.join(app, 'node_modules', 'next', 'package.json'),
      JSON.stringify({ name: 'next', version: '16.0.0' })
    )
    fs.writeFileSync(
      path.join(app, 'next.config.ts'),
      `const nextConfig = { reactStrictMode: true }\nexport default nextConfig\n`
    )
    return { root, app }
  }

  it('activates the workspace child config from the root, hook at the root', () => {
    const { root, app } = makeMonorepo()
    targeting(root)

    expect(run({ cli: true })).toBe('activated')

    const wired = read(app, 'next.config.ts')
    expect(wired).toContain(MARKER)
    expect(wired).toContain('import blazefire from "blazefire/plugin";')
    expect(read(app, path.join(BACKUP_DIR, 'next.config.ts'))).toContain(
      'export default nextConfig'
    )

    const rootPkg = JSON.parse(read(root, 'package.json'))
    expect(rootPkg.scripts.postinstall).toBe(HOOK_COMMAND)
  })

  it('restore from the root undoes the child activation and the hook', () => {
    const { root, app } = makeMonorepo()
    targeting(root)
    expect(run({ cli: true })).toBe('activated')

    expect(restore()).toBe(0)

    expect(read(app, 'next.config.ts')).toContain('export default nextConfig\n')
    expect(read(app, 'next.config.ts')).not.toContain(MARKER)
    expect(exists(app, BACKUP_DIR)).toBe(false)
    const rootPkg = JSON.parse(read(root, 'package.json'))
    expect(rootPkg.scripts.postinstall).toBeUndefined()
  })
})

describe('restore lifecycle', () => {
  it('round-trips: config, hook and backup all return to the original', () => {
    const root = makeProject({ config: CJS_CONFIG })
    targeting(root)
    expect(run({ cli: true })).toBe('activated')

    expect(restore()).toBe(0)
    expect(read(root, 'next.config.js')).toBe(CJS_CONFIG)
    expect(exists(root, BACKUP_DIR)).toBe(false) // backup consumed
    const pkg = JSON.parse(read(root, 'package.json'))
    expect(pkg.scripts.postinstall).toBeUndefined()
    expect(pkg.dependencies).toEqual({ next: '16.0.0', blazefire: '^1.1.2' })
  })

  it('a second restore reports nothing to restore (regression)', () => {
    const root = makeProject({ config: CJS_CONFIG })
    targeting(root)
    expect(run({ cli: true })).toBe('activated')
    expect(restore()).toBe(0)
    expect(restore()).toBe(1)
  })

  it('never re-copies a stale backup over later edits (regression: data loss)', () => {
    const root = makeProject({ config: CJS_CONFIG })
    targeting(root)
    expect(run({ cli: true })).toBe('activated')
    expect(restore()).toBe(0)

    // The user edits their config after restoring…
    const edited = `const nextConfig = { reactStrictMode: false, images: { unoptimized: true } }\nmodule.exports = nextConfig\n`
    fs.writeFileSync(path.join(root, 'next.config.js'), edited)

    // …then activates again. The NEW backup must capture the edited config,
    // not keep the original one from before their edit.
    expect(run({ cli: true })).toBe('activated')
    expect(read(root, path.join(BACKUP_DIR, 'next.config.js'))).toBe(edited)

    expect(restore()).toBe(0)
    expect(read(root, 'next.config.js')).toBe(edited) // their edit survives
  })

  it('reports 1 when there was never anything to restore', () => {
    const root = makeProject({ config: CJS_CONFIG })
    targeting(root)
    expect(restore()).toBe(1)
    expect(read(root, 'next.config.js')).toBe(CJS_CONFIG)
  })

  it('the config file with priority is the one that gets wrapped', () => {
    // next.config.ts ranks above next.config.js in CONFIG_NAMES.
    const root = makeProject({
      config: CJS_CONFIG,
      configName: 'next.config.js',
    })
    fs.writeFileSync(path.join(root, 'next.config.ts'), ESM_CONFIG)
    targeting(root)

    expect(run({ cli: true })).toBe('activated')
    expect(read(root, 'next.config.ts')).toContain(MARKER)
    expect(read(root, 'next.config.js')).toBe(CJS_CONFIG) // untouched
  })
})
