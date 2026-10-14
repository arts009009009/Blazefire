/**
 * Regenerates logo-data.cjs from assets/blazefire-logo.png.
 *
 * The overlay styles are bundled into the CLIENT runtime (runtime/inject.cjs
 * is injected as an entry), so branding.cjs cannot read the PNG with `fs` at
 * runtime. The asset is instead baked into a plain string module ahead of
 * time by this script.
 *
 * Run after replacing the logo:
 *
 *   node blazefire/build-logo-data.cjs
 */

'use strict'

const fs = require('fs')
const path = require('path')

const source = path.join(__dirname, 'assets', 'blazefire-logo.png')
const target = path.join(__dirname, 'logo-data.cjs')

if (!fs.existsSync(source)) {
  console.error('[blazefire] missing ' + source + ' — nothing to build.')
  process.exit(1)
}

const base64 = fs.readFileSync(source).toString('base64')

const out = [
  '/**',
  ' * GENERATED FILE — do not edit by hand.',
  ' *',
  ' * Source: assets/blazefire-logo.png',
  ' * Regenerate: node blazefire/build-logo-data.cjs',
  ' */',
  '',
  "'use strict'",
  '',
  "module.exports = 'data:image/png;base64," + base64 + "'",
  '',
].join('\n')

fs.writeFileSync(target, out)
console.log('[blazefire] wrote ' + target + ' (' + base64.length + ' base64 chars)')
