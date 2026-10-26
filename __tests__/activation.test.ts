import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BACKUP_DIR,
  HOOK_COMMAND,
  chainAfterHost,
  ensureHook,
  isLifecycleHook,
  locateCandidates,
  restore,
  run,
  undoHook,
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

  it('chains the activation hook when the host script only mentions Blazefire', () => {
    const packageJson = join(projectRoot, 'package.json')
    writeFileSync(
      packageJson,
      JSON.stringify({ scripts: { postinstall: 'echo "blazefire is installed"' } })
    )

    expect(ensureHook(projectRoot)).toEqual({ status: 'changed' })
    expect(JSON.parse(readFileSync(packageJson, 'utf8')).scripts.postinstall).toBe(
      `echo "blazefire is installed" && ${HOOK_COMMAND}`
    )
    expect(isLifecycleHook('blazefire init')).toBe(false)
    expect(isLifecycleHook(HOOK_COMMAND)).toBe(true)
  })

  it('restores backed-up configs and hooks in configured workspaces', () => {
    const workspaceRoot = join(projectRoot, 'apps', 'web')
    const configName = 'next.config.js'
    const rootConfig = join(projectRoot, configName)
    const workspaceConfig = join(workspaceRoot, configName)
    mkdirSync(workspaceRoot, { recursive: true })
    writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({
      workspaces: ['apps/web'],
      scripts: { postinstall: HOOK_COMMAND },
    }))
    writeFileSync(join(workspaceRoot, 'package.json'), JSON.stringify({
      scripts: { postinstall: HOOK_COMMAND },
    }))
    writeFileSync(rootConfig, 'module.exports = blazefire({ root: true })\n')
    writeFileSync(workspaceConfig, 'module.exports = blazefire({ workspace: true })\n')
    writeFileSync(
      join(projectRoot, BACKUP_DIR, 'next.config.js.2026-01-01T00-00-00-000Z.original'),
      'module.exports = { root: true }\n'
    )
    mkdirSync(join(workspaceRoot, BACKUP_DIR))
    writeFileSync(
      join(workspaceRoot, BACKUP_DIR, 'next.config.js.2026-01-01T00-00-00-000Z.original'),
      'module.exports = { workspace: true }\n'
    )

    expect(restore(projectRoot)).toBe(true)
    expect(readFileSync(rootConfig, 'utf8')).toBe('module.exports = { root: true }\n')
    expect(readFileSync(workspaceConfig, 'utf8')).toBe('module.exports = { workspace: true }\n')
    expect(JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')).scripts.postinstall)
      .toBeUndefined()
  })

  it('discovers Next.js configs in globbed workspaces without a root config', () => {
    const workspaceRoot = join(projectRoot, 'apps', 'web')
    mkdirSync(workspaceRoot, { recursive: true })
    writeFileSync(
      join(projectRoot, 'package.json'),
      JSON.stringify({ workspaces: ['apps/*'] })
    )
    writeFileSync(join(workspaceRoot, 'package.json'), '{}')
    writeFileSync(join(workspaceRoot, 'next.config.js'), 'module.exports = {}\n')

    expect(locateCandidates(projectRoot)).toEqual({
      configs: [join(workspaceRoot, 'next.config.js')],
      packageRoots: [workspaceRoot],
    })
  })

  it('excludes workspaces matched by negated patterns', () => {
    const webRoot = join(projectRoot, 'apps', 'web')
    const legacyRoot = join(projectRoot, 'apps', 'legacy')
    mkdirSync(webRoot, { recursive: true })
    mkdirSync(legacyRoot, { recursive: true })
    writeFileSync(
      join(projectRoot, 'package.json'),
      JSON.stringify({ workspaces: ['apps/*', '!apps/legacy'] })
    )
    for (const workspaceRoot of [webRoot, legacyRoot]) {
      writeFileSync(join(workspaceRoot, 'package.json'), '{}')
      writeFileSync(join(workspaceRoot, 'next.config.js'), 'module.exports = {}\n')
    }

    expect(locateCandidates(projectRoot)).toEqual({
      configs: [join(webRoot, 'next.config.js')],
      packageRoots: [webRoot],
    })
  })
})

describe('hook chaining (v1 bug: bare `&&` let host separators swallow the hook)', () => {
  let projectRoot: string

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'blazefire-chain-'))
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
  })

  const writeHost = (postinstall: string): string => {
    const packageJson = join(projectRoot, 'package.json')
    writeFileSync(packageJson, JSON.stringify({ scripts: { postinstall } }))
    return packageJson
  }

  const currentPostinstall = (packageJson: string): string =>
    (JSON.parse(readFileSync(packageJson, 'utf8')) as { scripts: { postinstall: string } })
      .scripts.postinstall

  it('chains plain one-shot host scripts flat, byte-identical to v1', () => {
    const packageJson = writeHost('next build')
    expect(ensureHook(projectRoot)).toEqual({ status: 'changed' })
    expect(currentPostinstall(packageJson)).toBe(`next build && ${HOOK_COMMAND}`)
  })

  it('groups hosts carrying `;`, background `&`, comments or newlines', () => {
    for (const host of ['a; b', 'node watcher &', 'echo hi # note', 'a\nb']) {
      const packageJson = writeHost(host)
      expect(ensureHook(projectRoot)).toEqual({ status: 'changed' })
      const chained = currentPostinstall(packageJson)
      expect(chained).toBe(`(${host}\n) && ${HOOK_COMMAND}`)
      // Re-running install must NOT append the hook a second time.
      expect(isLifecycleHook(chained)).toBe(true)
      expect(ensureHook(projectRoot)).toEqual({ status: 'already-active' })
      expect(currentPostinstall(packageJson)).toBe(chained)
    }
  })

  it('undoHook restores a grouped host script byte-for-byte', () => {
    const host = 'lint; format # keep order'
    const packageJson = writeHost(host)
    expect(ensureHook(projectRoot)).toEqual({ status: 'changed' })
    expect(currentPostinstall(packageJson)).toBe(`(${host}\n) && ${HOOK_COMMAND}`)

    expect(undoHook(projectRoot).changed).toBe(true)
    expect(currentPostinstall(packageJson)).toBe(host)
  })

  it('round-trips a host script that already ends with a newline', () => {
    const host = 'build &\n'
    const packageJson = writeHost(host)
    ensureHook(projectRoot)
    undoHook(projectRoot)
    expect(currentPostinstall(packageJson)).toBe(host)
  })

  it('never wraps a mid-script subshell back into the host', () => {
    // Not something chainAfterHost produces, but undoHook must still be safe.
    expect(chainAfterHost('plain')).toBe(`plain && ${HOOK_COMMAND}`)
    expect(chainAfterHost('a; b')).toBe(`(a; b\n) && ${HOOK_COMMAND}`)
  })
})

describe('bulletproofing (malformed hosts, unreadable configs, `**` workspaces)', () => {
  let projectRoot: string

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'blazefire-edge-'))
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
  })

  it('refuses to rewrite a package.json that is not valid JSON, byte-for-byte', () => {
    const raw = '{ this is not json, trailing comma,, }'
    writeFileSync(join(projectRoot, 'package.json'), raw)

    expect(ensureHook(projectRoot)).toEqual({ status: 'invalid-package-json' })
    expect(readFileSync(join(projectRoot, 'package.json'), 'utf8')).toBe(raw)
  })

  it('refuses to rewrite a package.json that is valid JSON but not an object', () => {
    const raw = '["not", "a", "package"]'
    writeFileSync(join(projectRoot, 'package.json'), raw)

    expect(ensureHook(projectRoot)).toEqual({ status: 'invalid-package-json' })
    expect(readFileSync(join(projectRoot, 'package.json'), 'utf8')).toBe(raw)
  })

  it('leaves a non-string postinstall script untouched', () => {
    // `postinstall: 42` is a host bug — silently turning it into a shell
    // command would rewrite data we don't own.
    const raw = JSON.stringify({ scripts: { postinstall: 42 } }, null, 2)
    writeFileSync(join(projectRoot, 'package.json'), raw)

    expect(ensureHook(projectRoot)).toEqual({ status: 'host-script-invalid' })
    expect(readFileSync(join(projectRoot, 'package.json'), 'utf8')).toBe(raw)
    expect(undoHook(projectRoot)).toEqual({ changed: false })
  })

  it('leaves a non-object scripts field untouched', () => {
    const raw = JSON.stringify({ scripts: 'nope' }, null, 2)
    writeFileSync(join(projectRoot, 'package.json'), raw)

    expect(ensureHook(projectRoot)).toEqual({ status: 'host-script-invalid' })
    expect(readFileSync(join(projectRoot, 'package.json'), 'utf8')).toBe(raw)
  })

  it('keeps a CRLF package.json as CRLF throughout (never mixed endings)', () => {
    const original = '{\r\n  "name": "crlf-demo",\r\n  "scripts": {}\r\n}\r\n'
    writeFileSync(join(projectRoot, 'package.json'), original)

    expect(ensureHook(projectRoot)).toEqual({ status: 'changed' })
    const out = readFileSync(join(projectRoot, 'package.json'), 'utf8')
    expect(out.replace(/\r\n/g, '')).not.toContain('\n') // no bare LF anywhere
    expect(out.endsWith('\r\n')).toBe(true)
    expect(JSON.parse(out).scripts.postinstall).toBe(HOOK_COMMAND)
  })

  it('hooks a BOM-prefixed package.json and keeps the BOM', () => {
    // npm tolerates a UTF-8 BOM; JSON.parse alone does not. Windows-authored
    // package.json files must not silently lose their hook.
    const original = '\uFEFF{\n  "name": "bom-demo",\n  "scripts": {}\n}\n'
    writeFileSync(join(projectRoot, 'package.json'), original)

    expect(ensureHook(projectRoot)).toEqual({ status: 'changed' })
    const out = readFileSync(join(projectRoot, 'package.json'), 'utf8')
    expect(out.charCodeAt(0)).toBe(0xfeff)
    expect(JSON.parse(out.slice(1)).scripts.postinstall).toBe(HOOK_COMMAND)

    expect(undoHook(projectRoot).changed).toBe(true)
    const undone = readFileSync(join(projectRoot, 'package.json'), 'utf8')
    expect(undone.charCodeAt(0)).toBe(0xfeff)
    expect(JSON.parse(undone.slice(1)).scripts.postinstall).toBeUndefined()
  })

  it('never treats a dependency as a workspace through a `**` pattern', () => {
    writeFileSync(
      join(projectRoot, 'package.json'),
      JSON.stringify({ name: 'root', workspaces: ['**'] })
    )
    mkdirSync(join(projectRoot, 'packages', 'app'), { recursive: true })
    writeFileSync(join(projectRoot, 'packages', 'app', 'package.json'), '{"name":"app"}')
    writeFileSync(join(projectRoot, 'packages', 'app', 'next.config.js'), 'module.exports = {}\n')

    mkdirSync(join(projectRoot, 'node_modules', 'some-dep'), { recursive: true })
    writeFileSync(join(projectRoot, 'node_modules', 'some-dep', 'package.json'), '{"name":"dep"}')
    writeFileSync(
      join(projectRoot, 'node_modules', 'some-dep', 'next.config.js'),
      'module.exports = {}\n'
    )

    const { configs } = locateCandidates(projectRoot)
    expect(configs.some((config) => config.includes('node_modules'))).toBe(false)
    expect(configs.some((config) => config.includes(join('packages', 'app')))).toBe(true)
  })

  it('keeps activating the remaining configs when one is unreadable', () => {
    writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({ name: 'iso' }))
    // A DIRECTORY named next.config.js makes readFileSync throw EISDIR for
    // every user (including root, where chmod 000 would not) — a reliable
    // stand-in for a corrupt/unreadable config.
    mkdirSync(join(projectRoot, 'next.config.js'))
    writeFileSync(
      join(projectRoot, 'next.config.mjs'),
      'const nextConfig = { a: 1 }\nexport default nextConfig\n'
    )
    // Minimal resolvable Next.js so hasInstalledNext passes.
    mkdirSync(join(projectRoot, 'node_modules', 'next', 'dist', 'server'), { recursive: true })
    writeFileSync(join(projectRoot, 'node_modules', 'next', 'package.json'), '{"name":"next"}')
    writeFileSync(join(projectRoot, 'node_modules', 'next', 'dist', 'server', 'next.js'), '{}\n')

    expect(run(projectRoot)).toBe('activated')
    expect(readFileSync(join(projectRoot, 'next.config.mjs'), 'utf8')).toContain(
      'export default blazefire(nextConfig)'
    )
    expect(JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')).scripts.postinstall).toBe(
      HOOK_COMMAND
    )
  })
})
