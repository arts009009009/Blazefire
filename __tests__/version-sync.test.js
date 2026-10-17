/**
 * Version-sync guard.
 *
 * The package version appears in several places that cannot all share one
 * runtime source (browser-bundled ESM has no safe way to read package.json),
 * so they are mirrored by hand — and this suite fails the moment a release
 * bumps one without the others. See the comment block in blazefire/utils.js.
 */

'use strict'

const fs = require('fs')
const path = require('path')
const pkg = require('../package.json')

const branding = require('../blazefire/branding.cjs')
const plugin = require('../blazefire/plugin.cjs')

import { BLAZEFIRE_VERSION, FROSTFAST_VERSION } from '../blazefire/utils.js'

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')

describe('the reported version equals the installed version', () => {
  it('utils.js (browser-bundled ESM constant)', () => {
    expect(BLAZEFIRE_VERSION).toBe(pkg.version)
  })

  it('src/index.tsx (types entry constant)', () => {
    const m = read('blazefire/src/index.tsx').match(
      /export const BLAZEFIRE_VERSION = '([^']+)'/
    )
    expect(m).not.toBeNull()
    expect(m[1]).toBe(pkg.version)
  })

  it('branding.cjs (read from package.json at load time)', () => {
    expect(branding.BLAZEFIRE_BRANDING.version).toBe(pkg.version)
  })

  it('plugin DEFAULTS (what NEXT_PUBLIC_BLAZEFIRE_VERSION advertises)', () => {
    expect(plugin.DEFAULTS.version).toBe('v' + pkg.version)
    const cfg = plugin({ theme: false, overlay: false })
    expect(cfg.env.NEXT_PUBLIC_BLAZEFIRE_VERSION).toBe('v' + pkg.version)
  })

  it('the dev-overlay label and title carry the installed version', () => {
    const label = branding.BLAZEFIRE_BRANDING.labels.find(
      (l) => l.selector === '[data-nextjs-version-checker]'
    )
    expect(label.replace).toBe('Blazefire ' + pkg.version)
    expect(label.title).toBe('Blazefire ' + pkg.version)
  })

  it('the startup banner carries the installed version', () => {
    expect(branding.BLAZEFIRE_BRANDING.banner).toContain('v' + pkg.version)
  })

  it('the response headers match the branding defaults', () => {
    expect(branding.BLAZEFIRE_BRANDING.headers.poweredBy).toBe(
      plugin.DEFAULTS.poweredBy
    )
    expect(branding.BLAZEFIRE_BRANDING.headers.compiler).toBe(
      plugin.DEFAULTS.compiler
    )
  })
})

describe('Frostfast compiler version', () => {
  it('is consistent between the ESM entry and branding', () => {
    expect(FROSTFAST_VERSION).toBe(branding.BLAZEFIRE_BRANDING.compilerVersion)
  })

  it('is consistent with the compiler subpath entry', async () => {
    const compiler = await import('../blazefire/src/compiler/index.js')
    expect(compiler.COMPILER_VERSION).toBe(FROSTFAST_VERSION)
  })
})
