/**
 * Package-manager compatibility — unit layer.
 *
 * Lockfile/user-agent detection and command construction for all four
 * supported package managers (npm, pnpm, yarn, bun), plus child-process exit
 * propagation. The REAL end-to-end installs through each PM live in
 * pm-matrix.test.js.
 */

'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const upd = require('../blazefire/update-check.cjs')

const SPEC = 'file:/tmp/blazefire-fixture.tgz'

describe('detectPackageManager — lockfiles', () => {
  let scratch
  const originalUA = process.env.npm_config_user_agent

  beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-pm-'))
    delete process.env.npm_config_user_agent
  })

  afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true })
    if (originalUA === undefined) delete process.env.npm_config_user_agent
    else process.env.npm_config_user_agent = originalUA
  })

  it('detects each lockfile format', () => {
    const cases = [
      ['package-lock.json', 'npm'],
      ['pnpm-lock.yaml', 'pnpm'],
      ['yarn.lock', 'yarn'],
      ['bun.lockb', 'bun'],
      ['bun.lock', 'bun'], // the text lockfile bun 1.2+ writes
    ]
    for (const [lockfile, expected] of cases) {
      fs.writeFileSync(path.join(scratch, lockfile), '')
      expect(upd.detectPackageManager(scratch)).toBe(expected)
      fs.rmSync(path.join(scratch, lockfile))
    }
  })

  it('prefers pnpm > yarn > bun > npm when lockfiles coexist', () => {
    fs.writeFileSync(path.join(scratch, 'pnpm-lock.yaml'), '')
    fs.writeFileSync(path.join(scratch, 'yarn.lock'), '')
    fs.writeFileSync(path.join(scratch, 'bun.lock'), '')
    expect(upd.detectPackageManager(scratch)).toBe('pnpm')

    fs.rmSync(path.join(scratch, 'pnpm-lock.yaml'))
    expect(upd.detectPackageManager(scratch)).toBe('yarn')

    fs.rmSync(path.join(scratch, 'yarn.lock'))
    expect(upd.detectPackageManager(scratch)).toBe('bun')

    fs.rmSync(path.join(scratch, 'bun.lock'))
    expect(upd.detectPackageManager(scratch)).toBe('npm')
  })

  it('the user agent always wins over lockfiles', () => {
    fs.writeFileSync(path.join(scratch, 'pnpm-lock.yaml'), '')
    process.env.npm_config_user_agent = 'yarn/1.22.22 npm/? node/v22'
    expect(upd.detectPackageManager(scratch)).toBe('yarn')

    process.env.npm_config_user_agent = 'bun/1.4.2'
    expect(upd.detectPackageManager(scratch)).toBe('bun')

    process.env.npm_config_user_agent = 'npm/9.2.0 node/v22'
    expect(upd.detectPackageManager(scratch)).toBe('npm')
  })

  it('falls back to npm for unknown user agents', () => {
    process.env.npm_config_user_agent = 'weirdpm/1.0'
    expect(upd.detectPackageManager(scratch)).toBe('npm')
  })
})

describe('updateCommand — per package manager', () => {
  let scratch

  beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-pmc-'))
    fs.writeFileSync(
      path.join(scratch, 'package.json'),
      JSON.stringify({ name: 'fixture', dependencies: { blazefire: SPEC } })
    )
  })

  afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true })
  })

  it('npm installs, the others add — each with the installed spec verbatim', () => {
    expect(upd.updateCommand(scratch, 'npm')).toEqual({
      command: 'npm',
      args: ['install', SPEC],
    })
    for (const pm of ['pnpm', 'yarn', 'bun']) {
      expect(upd.updateCommand(scratch, pm)).toEqual({
        command: pm,
        args: ['add', SPEC],
      })
    }
  })

  it('an unknown manager name falls back to npm', () => {
    expect(upd.updateCommand(scratch, 'carrier-pigeon')).toEqual({
      command: 'npm',
      args: ['install', SPEC],
    })
  })

  it('reads the spec from devDependencies when not in dependencies', () => {
    fs.writeFileSync(
      path.join(scratch, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        devDependencies: { blazefire: 'github:arts009009009/Blazefire' },
      })
    )
    expect(upd.updateCommand(scratch, 'yarn')).toEqual({
      command: 'yarn',
      args: ['add', 'github:arts009009009/Blazefire'],
    })
  })
})

describe('runUpdate — yarn and bun child processes', () => {
  const originalPath = process.env.PATH
  const originalUA = process.env.npm_config_user_agent
  const created = []

  function fakePm(name, exitCode) {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-pmbin-'))
    created.push(bin)
    const log = path.join(bin, 'invocation.log')
    fs.writeFileSync(
      path.join(bin, name),
      `#!/bin/sh\necho "$@" >> "${log}"\nexit ${exitCode}\n`,
      { mode: 0o755 }
    )
    return { bin, log }
  }

  function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-pmrun-'))
    created.push(root)
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        dependencies: { blazefire: SPEC },
      })
    )
    return root
  }

  const runUpdate = (root) =>
    new Promise((resolve) => upd.runUpdate(root, resolve))

  afterEach(() => {
    process.env.PATH = originalPath
    if (originalUA === undefined) delete process.env.npm_config_user_agent
    else process.env.npm_config_user_agent = originalUA
    for (const dir of created.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('yarn: `add <spec>`, exit code propagated', async () => {
    const { bin, log } = fakePm('yarn', 3)
    process.env.PATH = bin + path.delimiter + originalPath
    process.env.npm_config_user_agent = 'yarn/1.22.22 npm/? node/v22'

    expect(await runUpdate(fixture())).toBe(3)
    expect(fs.readFileSync(log, 'utf8').trim()).toBe('add ' + SPEC)
  })

  it('bun: `add <spec>`, exit code propagated', async () => {
    const { bin, log } = fakePm('bun', 0)
    process.env.PATH = bin + path.delimiter + originalPath
    process.env.npm_config_user_agent = 'bun/1.4.2'

    expect(await runUpdate(fixture())).toBe(0)
    expect(fs.readFileSync(log, 'utf8').trim()).toBe('add ' + SPEC)
  })

  it('a missing package manager reports exit 1 instead of throwing', async () => {
    process.env.PATH = '' // nothing is executable
    process.env.npm_config_user_agent = 'bun/1.4.2'
    expect(await runUpdate(fixture())).toBe(1)
  })
})
