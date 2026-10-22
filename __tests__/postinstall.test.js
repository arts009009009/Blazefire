/**
 * Tests for the next.config rewrite and self-activation hook in
 * `blazefire/postinstall.cjs` — the engine behind `npx blazefire init`.
 */

'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const ts = require('typescript')
const {
  rewrite,
  plan,
  ensureHook,
  undoHook,
  MARKER,
  BACKUP_DIR,
  HOOK_COMMAND,
} = require('../blazefire/postinstall.cjs')

const HOOK_RECORD = 'scripts.postinstall.json'

beforeAll(() => {
  delete process.env.BLAZEFIRE_SKIP_AUTO
})

afterEach(() => {
  delete process.env.BLAZEFIRE_SKIP_AUTO
})

describe('rewrite — ESM configs', () => {
  it('wraps `export default nextConfig;`', () => {
    const out = rewrite(
      'const nextConfig = { trailingSlash: true };\nexport default nextConfig;\n'
    )
    expect(out.ok).toBe(true)
    expect(out.code).toContain('import blazefire from "blazefire/plugin";')
    expect(out.code).toContain('export default blazefire(nextConfig);')
    expect(out.code).toContain('const nextConfig = { trailingSlash: true };')
  })

  it('keeps the import above the export and respects a shebang', () => {
    const out = rewrite('#!/usr/bin/env node\nexport default { a: 1 };\n')
    expect(out.ok).toBe(true)
    const lines = out.code.split('\n')
    expect(lines[0]).toBe('#!/usr/bin/env node')
    expect(out.code.indexOf('import blazefire')).toBeLessThan(
      out.code.indexOf('export default blazefire')
    )
  })

  it('wraps an inline object config', () => {
    const out = rewrite('export default { images: { unoptimized: true } };\n')
    expect(out.ok).toBe(true)
    expect(out.code).toContain(
      'export default blazefire({ images: { unoptimized: true } });'
    )
  })

  it('wraps a function-style config', () => {
    const out = rewrite(
      'export default (phase) => ({ trailingSlash: true });\n'
    )
    expect(out.ok).toBe(true)
    expect(out.code).toContain(
      'export default blazefire((phase) => ({ trailingSlash: true }));'
    )
  })

  it('keeps a `satisfies` clause inside the wrapped expression', () => {
    const out = rewrite(
      'const nextConfig = {};\nexport default nextConfig satisfies NextConfig;\n'
    )
    expect(out.ok).toBe(true)
    expect(out.code).toContain('blazefire(nextConfig satisfies NextConfig);')
  })

  it('preserves regex literals containing escaped URL delimiters', () => {
    const source = String.raw`export default { matcher: /https?:\/\// }
const afterConfig = true
`
    const out = rewrite(source)

    expect(out.ok).toBe(true)
    expect(out.code).toContain('matcher: /https?:\\/\\//')
    expect(out.code).toContain('export default blazefire({')
    expect(out.code).toContain('const afterConfig = true')
    expect(
      ts.createSourceFile('next.config.ts', out.code, ts.ScriptTarget.Latest)
        .parseDiagnostics
    ).toHaveLength(0)
  })

  it('preserves CRLF line endings', () => {
    const out = rewrite('const a = 1;\r\nexport default a;\r\n')
    expect(out.ok).toBe(true)
    expect(out.code).toContain('import blazefire from "blazefire/plugin";\r\n')
    expect(out.code).not.toMatch(/(?<!\r)\nexport default blazefire/)
  })

  it('refuses a file with two `export default`s rather than wrapping one', () => {
    const out = plan('export default { a: 1 };\nexport default { b: 2 };\n')
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/more than once/)
  })
})

describe('rewrite — CommonJS configs', () => {
  it('wraps `module.exports = cfg;`', () => {
    const out = rewrite(
      'const cfg = { trailingSlash: true };\nmodule.exports = cfg;\n'
    )
    expect(out.ok).toBe(true)
    expect(out.code).toContain('const blazefire = require("blazefire/plugin");')
    expect(out.code).toContain('module.exports = blazefire(cfg);')
  })

  it('accepts `module.exports.env = …` alongside the one export', () => {
    // Regression: a property assignment was mistaken for a second default
    // export, so an ordinary config was refused and forced a manual paste.
    const out = rewrite(
      'const cfg = { trailingSlash: true };\nmodule.exports = cfg;\nmodule.exports.env = { FOO: "bar" };\n'
    )
    expect(out.ok).toBe(true)
    expect(out.code).toContain('module.exports = blazefire(cfg);')
    expect(out.code).toContain('module.exports.env = { FOO: "bar" };')
  })

  it('still refuses a genuine second `module.exports =`', () => {
    const out = plan('module.exports = { a: 1 };\nmodule.exports = { b: 2 };\n')
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/more than once/)
  })

  it('reports configs with no export at all', () => {
    expect(plan('const a = 1;\n').ok).toBe(false)
  })
})

describe('rewrite — idempotency marker survives', () => {
  it('leaves an already-wrapped config recognisable', () => {
    const once = rewrite('export default { a: 1 };\n')
    expect(once.ok).toBe(true)
    expect(once.code).toContain('blazefire/plugin')
    // `run()` keys off this string to avoid wrapping twice.
    expect(MARKER).toBe('blazefire/plugin')
  })
})

/* ------------------------------------------------------------------ *
 * self-activation hook
 * ------------------------------------------------------------------ */

function makeProject(pkg) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blazefire-test-'))
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(pkg, null, 2) + '\n'
  )
  return dir
}

function readPkg(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
}

function recordPath(dir) {
  return path.join(dir, BACKUP_DIR, HOOK_RECORD)
}

describe('ensureHook / undoHook', () => {
  it('chains onto an existing postinstall and restores it exactly', () => {
    const original = 'husky install && node scripts/setup.js'
    const dir = makeProject({
      dependencies: { blazefire: '^1.0.0' },
      scripts: { postinstall: original },
    })

    expect(ensureHook(dir)).toBe(true)
    expect(readPkg(dir).scripts.postinstall).toBe(
      HOOK_COMMAND + ' && ' + original
    )
    expect(fs.existsSync(recordPath(dir))).toBe(true)

    expect(undoHook(dir)).toBe(true)
    expect(readPkg(dir).scripts.postinstall).toBe(original)
    expect(fs.existsSync(recordPath(dir))).toBe(false)

    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('creates the script when there was none, and removes it on undo', () => {
    const dir = makeProject({ dependencies: { blazefire: '^1.0.0' } })

    expect(ensureHook(dir)).toBe(true)
    expect(readPkg(dir).scripts.postinstall).toBe(HOOK_COMMAND)

    expect(undoHook(dir)).toBe(true)
    expect(readPkg(dir).scripts.postinstall).toBeUndefined()
    expect(fs.existsSync(recordPath(dir))).toBe(false)

    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('does not add the hook twice', () => {
    const dir = makeProject({ dependencies: { blazefire: '^1.0.0' } })

    expect(ensureHook(dir)).toBe(true)
    const once = readPkg(dir).scripts.postinstall
    expect(ensureHook(dir)).toBe(false)
    expect(readPkg(dir).scripts.postinstall).toBe(once)

    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('does not treat an unrelated script that merely mentions blazefire as ours', () => {
    // Regression: the old pattern matched any script containing "blazefire"
    // anywhere before "init", so this was wrongly seen as an installed hook
    // and the real hook was never written.
    const dir = makeProject({
      dependencies: { blazefire: '^1.0.0' },
      scripts: { postinstall: 'blazefire-docs init:watch' },
    })

    expect(ensureHook(dir)).toBe(true)
    expect(readPkg(dir).scripts.postinstall).toBe(
      HOOK_COMMAND + ' && blazefire-docs init:watch'
    )

    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('reports failure — and keeps the record — when the script is no longer ours', () => {
    const dir = makeProject({
      dependencies: { blazefire: '^1.0.0' },
      scripts: { postinstall: 'node setup.js' },
    })

    ensureHook(dir)
    expect(fs.existsSync(recordPath(dir))).toBe(true)

    // The user replaces our hook with their own script.
    const pkg = readPkg(dir)
    pkg.scripts.postinstall = 'their own replacement'
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify(pkg, null, 2) + '\n'
    )

    // Regression: this used to return true (so `restore` claimed success) and
    // deleted the record — the only copy of their original script.
    expect(undoHook(dir)).toBe(false)
    expect(readPkg(dir).scripts.postinstall).toBe('their own replacement')
    expect(fs.existsSync(recordPath(dir))).toBe(true)

    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('honours BLAZEFIRE_SKIP_AUTO', () => {
    const dir = makeProject({ dependencies: { blazefire: '^1.0.0' } })
    process.env.BLAZEFIRE_SKIP_AUTO = '1'
    expect(ensureHook(dir)).toBe(false)
    expect(readPkg(dir).scripts).toBeUndefined()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
