/**
 * Packaging contract: everything the manifest promises must actually exist,
 * resolve, and fit inside the published `files` allow-list.
 *
 * The relative-import sweep is the regression net for the worst class of bug
 * this package ever shipped: `src/components/BlazefireDevTools.js` imported a
 * module that did not exist (`../index.js`), which only surfaced in a
 * consumer's `ERR_MODULE_NOT_FOUND` — every test inside the repo passed.
 */

'use strict'

const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const pkg = require('../package.json')
const ROOT = path.join(__dirname, '..')
const PKG_DIR = path.join(ROOT, 'blazefire')

const exists = (rel) => fs.existsSync(path.join(ROOT, rel))

/* ------------------------------------------------------------------ *
 * manifest fields
 * ------------------------------------------------------------------ */

describe('manifest entry points', () => {
  it('main / types / bin all point at real files', () => {
    expect(exists(pkg.main)).toBe(true)
    expect(exists(pkg.types)).toBe(true)
    for (const target of Object.values(pkg.bin)) {
      expect(exists(target)).toBe(true)
    }
  })

  it('every non-glob exports target exists on disk', () => {
    const targets = []
    const walk = (value) => {
      if (typeof value === 'string') targets.push(value)
      else if (value && typeof value === 'object')
        Object.values(value).forEach(walk)
    }
    walk(pkg.exports)

    expect(targets.length).toBeGreaterThan(0)
    for (const target of targets) {
      if (target.includes('*')) continue // globs checked below
      expect(exists(target)).toBe(true)
    }
  })

  it('cli entry is executable-style (shebang first line)', () => {
    const head = fs.readFileSync(path.join(ROOT, pkg.bin.blazefire), 'utf8')
    expect(head.startsWith('#!')).toBe(true)
    const post = fs.readFileSync(path.join(PKG_DIR, 'postinstall.cjs'), 'utf8')
    expect(post.startsWith('#!')).toBe(true)
  })

  it('every JSON file in data/ parses', () => {
    const dir = path.join(PKG_DIR, 'data')
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      expect(() =>
        JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
      ).not.toThrow()
    }
  })
})

/* ------------------------------------------------------------------ *
 * components subpath wildcard: every shipped component must have BOTH
 * halves of the `./components/*` export (runtime .js + types .tsx)
 * ------------------------------------------------------------------ */

describe('blazefire/components/* export pairs', () => {
  const dir = path.join(PKG_DIR, 'src', 'components')
  const files = fs.readdirSync(dir)

  const runtimes = files
    .filter((f) => f.endsWith('.js'))
    .map((f) => f.slice(0, -3))
  const types = files
    .filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
    .map((f) => f.replace(/\.tsx?$/, ''))

  it('has components to check', () => {
    expect(runtimes.length).toBeGreaterThan(0)
  })

  it('every runtime .js has a types file the wildcard can resolve', () => {
    // The exports entry promises `types: ./blazefire/src/components/*.tsx` —
    // a .ts sibling would NOT satisfy it.
    for (const name of runtimes) {
      expect(fs.existsSync(path.join(dir, name + '.tsx'))).toBe(true)
    }
  })

  it('every types file ships a runtime .js implementation', () => {
    for (const name of types) {
      expect(fs.existsSync(path.join(dir, name + '.js'))).toBe(true)
    }
  })
})

/* ------------------------------------------------------------------ *
 * relative import sweep
 * ------------------------------------------------------------------ */

/** All shipped source files (everything that can carry a relative import). */
function shippedSourceFiles() {
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (/\.(js|cjs|mjs|ts|tsx)$/.test(entry.name)) {
        out.push(full)
      }
    }
  }
  walk(PKG_DIR)
  return out
}

/** Extract every relative module specifier from a source file. */
function relativeSpecifiers(code) {
  const specs = []
  const patterns = [
    /\bfrom\s*['"](\.[^'"]+)['"]/g, // import/export … from '…'
    /\brequire\(\s*['"](\.[^'"]+)['"]\s*\)/g, // require('…')
    /\bimport\(\s*['"](\.[^'"]+)['"]\s*\)/g, // dynamic import('…')
    /\bimport\s*['"](\.[^'"]+)['"]/g, // side-effect import '…'
  ]
  for (const re of patterns) {
    let m
    while ((m = re.exec(code))) specs.push(m[1])
  }
  return specs
}

/** Resolve a specifier the way Node/bundlers would (explicit ext first). */
function resolvesFrom(baseFile, spec, isTypeScriptFile) {
  const target = path.resolve(path.dirname(baseFile), spec)
  const candidates = [
    target,
    target + '.js',
    target + '.cjs',
    target + '.mjs',
    target + '.ts',
    target + '.tsx',
    target + '.d.ts',
    path.join(target, 'index.js'),
    path.join(target, 'index.ts'),
    path.join(target, 'index.tsx'),
  ]
  // TypeScript sources (only) may import a sibling as './foo.js' and mean
  // './foo.ts[x]' — the standard NodeNext convention. Shipped .js/.cjs files
  // get no such remap: a browser/Node runtime could not follow it.
  if (isTypeScriptFile && /\.(js|mjs|cjs)$/.test(spec)) {
    candidates.push(target.replace(/\.(js|mjs|cjs)$/, '.ts'))
    candidates.push(target.replace(/\.(js|mjs|cjs)$/, '.tsx'))
    candidates.push(target.replace(/\.(js|mjs|cjs)$/, '.d.ts'))
  }
  return candidates.some((c) => fs.existsSync(c) && fs.statSync(c).isFile())
}

describe('relative imports in shipped files resolve', () => {
  it('no file references a module that does not exist (the DevTools bug)', () => {
    const broken = []
    for (const file of shippedSourceFiles()) {
      const code = fs.readFileSync(file, 'utf8')
      const isTs = /\.(ts|tsx)$/.test(file)
      for (const spec of relativeSpecifiers(code)) {
        if (!resolvesFrom(file, spec, isTs)) {
          broken.push(path.relative(ROOT, file) + ' → ' + spec)
        }
      }
    }
    expect(broken).toEqual([])
  })

  it('components resolve as a consumer would import them', async () => {
    // Self-reference resolution: import through the package name, exactly as
    // a user's `import { BlazefireDevTools } from 'blazefire/components/…'`.
    const devtools = await import('blazefire/components/BlazefireDevTools')
    expect(typeof devtools.BlazefireDevTools).toBe('function')

    const logo = await import('blazefire/components/BlazefireLogo')
    expect(typeof logo.BlazefireLogo).toBe('function')

    const overlay = await import('blazefire/components/BlazefireErrorOverlay')
    expect(typeof overlay.BlazefireErrorOverlay).toBe('function')
  })
})

/* ------------------------------------------------------------------ *
 * files allow-list coverage
 * ------------------------------------------------------------------ */

describe('files allow-list covers the exports map', () => {
  /** Does some `files` entry cover this path? */
  function covered(relPath) {
    const rel = relPath.replace(/^\.\//, '')
    return pkg.files.some((entry) => {
      const clean = entry.replace(/\/$/, '')
      return rel === clean || rel.startsWith(clean + '/')
    })
  }

  it('covers main, types, bin and every exports target', () => {
    const targets = [pkg.main, pkg.types, ...Object.values(pkg.bin)]
    const walk = (value) => {
      if (typeof value === 'string') targets.push(value)
      else if (value && typeof value === 'object')
        Object.values(value).forEach(walk)
    }
    walk(pkg.exports)

    const uncovered = targets
      .filter((t) => !t.includes('*'))
      // npm always ships package.json (plus README/LICENSE) regardless of
      // the files allow-list — its exports entry needs no coverage.
      .filter((t) => t !== './package.json')
      .filter((t) => !covered(t))
    expect(uncovered).toEqual([])
  })

  it('covers the wildcard expansion of ./components/*', () => {
    const dir = path.join(PKG_DIR, 'src', 'components')
    for (const file of fs.readdirSync(dir)) {
      expect(covered('./blazefire/src/components/' + file)).toBe(true)
    }
  })
})

/* ------------------------------------------------------------------ *
 * npm pack: the tarball really contains what consumers need
 * ------------------------------------------------------------------ */

describe('npm pack dry run', () => {
  it('includes every runtime file consumers load', () => {
    const raw = execFileSync(
      'npm',
      ['pack', '--dry-run', '--json', '--ignore-scripts'],
      { cwd: ROOT, encoding: 'utf8', timeout: 60000 }
    )
    const report = JSON.parse(raw)
    const files = report[0].files.map((f) => f.path)

    const mustShip = [
      'blazefire/index.js',
      'blazefire/utils.js',
      'blazefire/provider.js',
      'blazefire/plugin.cjs',
      'blazefire/plugin.d.ts',
      'blazefire/branding.cjs',
      'blazefire/branding.d.ts',
      'blazefire/logo-data.cjs',
      'blazefire/postinstall.cjs',
      'blazefire/update-check.cjs',
      'blazefire/cli.cjs',
      'blazefire/runtime/inject.cjs',
      'blazefire/runtime/turbopack-loader.cjs',
      'blazefire/src/index.tsx',
      'blazefire/src/compiler/index.js',
      'blazefire/src/compiler/index.ts',
      'blazefire/src/components/BlazefireDevTools.js',
      'blazefire/src/components/BlazefireDevTools.tsx',
      'blazefire/assets/blazefire-global.css',
      'blazefire/data/theme.json',
      'package.json',
    ]

    const missing = mustShip.filter((f) => !files.includes(f))
    expect(missing).toEqual([])
  }, 90000)
})
