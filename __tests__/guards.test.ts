/**
 * Structural guards — the v2 mandates, enforced mechanically.
 *
 * These scan the real source tree so a regression (a webpack import, a
 * next/dist indirection, a hand-mirrored .js twin, a second branding copy)
 * fails CI instead of quietly creeping back.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const ROOT = join(__dirname, '..')
const SRC = join(ROOT, 'src')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const sourceFiles = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f))
const relative = (f: string): string => f.slice(ROOT.length + 1)

describe('mandate 1 — no legacy bundler bloat', () => {
  it('never imports webpack', () => {
    const offenders = sourceFiles.filter((f) =>
      /['"](?:next\/dist\/compiled\/)?webpack/.test(readFileSync(f, 'utf8'))
    )
    expect(offenders.map(relative)).toEqual([])
  })

  it('never imports from next/dist (no host-framework indirection)', () => {
    const offenders = sourceFiles.filter((f) =>
      /['"]next\/dist/.test(readFileSync(f, 'utf8'))
    )
    expect(offenders.map(relative)).toEqual([])
  })

  it('has no pages-router surface', () => {
    const offenders = sourceFiles.filter((f) => /getServerSideProps|\/pages\//.test(f))
    expect(offenders.map(relative)).toEqual([])
  })
})

describe('mandate 2 — single-source', () => {
  it('has exactly one branding module', () => {
    const brandingModules = sourceFiles.filter((f) =>
      /branding/i.test(f) && !f.includes('generated')
    )
    expect(brandingModules.map(relative)).toEqual([relative(join(SRC, 'branding.ts'))])
  })

  it('has exactly one stored logo asset', () => {
    const pngs = walk(ROOT)
      .filter((f) => f.endsWith('.png') && !f.includes('node_modules') && !f.includes('/dist/'))
    expect(pngs.map(relative)).toEqual(['blazefire-logo.png'])
  })

  it('has no hand-mirrored .js twins of .ts sources (H-04)', () => {
    const jsFiles = sourceFiles
      .map((f) => f.slice(0, -extname(f).length) + '.js')
      .filter((js) => existsSync(js))
    expect(jsFiles.map(relative)).toEqual([])
  })
})

describe('mandate 3 — identity pipelines are intact', () => {
  it('ships the activation engine (postinstall + CLI share it)', () => {
    expect(existsSync(join(SRC, 'postinstall', 'scanner.ts'))).toBe(true)
    expect(existsSync(join(SRC, 'postinstall', 'activation.ts'))).toBe(true)
    expect(existsSync(join(ROOT, 'scripts', 'postinstall-entry.mjs'))).toBe(true)
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
    expect(pkg.scripts.postinstall).toContain('postinstall-entry.mjs')
    expect(pkg.bin.blazefire).toBe('./dist/cli.js')
  })

  it('ships the update-check pipeline', () => {
    for (const module of ['semver', 'state', 'feed', 'pm', 'cache-purge', 'updater']) {
      expect(existsSync(join(SRC, 'update-check', `${module}.ts`))).toBe(true)
    }
  })

  it('keeps the Frostfast headers in the plugin output', () => {
    const { buildConfig } = require('../src/plugin') as typeof import('../src/plugin')
    const config = buildConfig({
      theme: true,
      overlay: true,
      headers: true,
    } as never)
    const headers = (config.headers as () => Promise<{ headers: Array<{ key: string; value: string }> }>)()
    return headers.then((resolved) => {
      const values = resolved.headers.map((h) => `${h.key}: ${h.value}`)
      expect(values).toContain('X-Powered-By: Blazefire Framework')
      expect(values).toContain('X-Compiler: Frostfast v2.0.0')
    })
  })

  it('injects the runtime only through turbopack.rules', () => {
    const { buildTurbopackRules } = require('../src/plugin') as typeof import('../src/plugin')
    const rules = buildTurbopackRules(true)
    const globs = Object.keys(rules)
    expect(globs.length).toBeGreaterThan(0)
    for (const glob of globs) {
      expect(rules[glob]![0]!.loader).toContain('turbopack-loader.js')
    }
  })
})

describe('mandate 4 — runtime overhead', () => {
  it('constructs no MutationObserver outside the dev-gated paths', () => {
    const inject = readFileSync(join(SRC, 'runtime', 'inject.ts'), 'utf8')
    // Every `new MutationObserver` must sit behind the `dev` guard.
    const observerSites = inject.match(/new MutationObserver/g) ?? []
    expect(observerSites.length).toBeGreaterThan(0)
    expect(inject).toContain('!dev || disposed') // production one-shot
    expect(inject).toContain('if (dev && !disposed')
  })

  it('serializes config compactly (no pretty-printing) and hashes it', () => {
    const serialize = readFileSync(join(SRC, 'config', 'serialize.ts'), 'utf8')
    expect(serialize).not.toMatch(/JSON\.stringify\([^)]*,\s*2\s*\)/)
    expect(serialize).toContain("createHash('sha256')")
  })
})
