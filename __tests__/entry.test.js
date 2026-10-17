/**
 * Contract tests for the package entry point (`blazefire/index.js`) and its
 * two halves (`utils.js`, `provider.js`).
 *
 * The split is deliberate and load-bearing — see the comments in index.js:
 * the `'use client'` directive must live on provider.js only, because marking
 * the entry would turn the plain utilities into client references and make a
 * server-side `insertBlazefireStyles()` throw. These tests pin that contract.
 */

'use strict'

const fs = require('fs')
const path = require('path')

import BlazefireDefault, {
  BLAZEFIRE_VERSION,
  FROSTFAST_VERSION,
  BlazefireProvider,
  createBlazefireLogo,
  createCompiler,
  insertBlazefireStyles,
  useBlazefire,
} from '../blazefire/index.js'

import * as Utils from '../blazefire/utils.js'
import * as Provider from '../blazefire/provider.js'

const pkg = require('../package.json')

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')

describe('entry point named exports', () => {
  it('exports the full documented surface', () => {
    expect(typeof BLAZEFIRE_VERSION).toBe('string')
    expect(typeof FROSTFAST_VERSION).toBe('string')
    expect(typeof insertBlazefireStyles).toBe('function')
    expect(typeof createBlazefireLogo).toBe('function')
    expect(typeof createCompiler).toBe('function')
    expect(typeof BlazefireProvider).toBe('function')
    expect(typeof useBlazefire).toBe('function')
  })

  it('re-exports the same function identities as its halves', () => {
    expect(BLAZEFIRE_VERSION).toBe(Utils.BLAZEFIRE_VERSION)
    expect(FROSTFAST_VERSION).toBe(Utils.FROSTFAST_VERSION)
    expect(insertBlazefireStyles).toBe(Utils.insertBlazefireStyles)
    expect(createBlazefireLogo).toBe(Utils.createBlazefireLogo)
    expect(createCompiler).toBe(Utils.createCompiler)
    expect(BlazefireProvider).toBe(Provider.BlazefireProvider)
    expect(useBlazefire).toBe(Provider.useBlazefire)
  })
})

describe('default export object', () => {
  it('mirrors the named exports', () => {
    expect(BlazefireDefault.version).toBe(BLAZEFIRE_VERSION)
    expect(BlazefireDefault.createCompiler).toBe(createCompiler)
    expect(BlazefireDefault.insertBlazefireStyles).toBe(insertBlazefireStyles)
    expect(BlazefireDefault.createBlazefireLogo).toBe(createBlazefireLogo)
    expect(BlazefireDefault.BlazefireProvider).toBe(BlazefireProvider)
    expect(BlazefireDefault.useBlazefire).toBe(useBlazefire)
  })

  it('advertises the installed version', () => {
    expect(BlazefireDefault.version).toBe(pkg.version)
  })
})

describe("'use client' placement (SSR-safety contract)", () => {
  const directive = /^\s*['"]use client['"];?/m

  it('provider.js carries the directive (its exports must be client refs)', () => {
    expect(directive.test(read('blazefire/provider.js'))).toBe(true)
  })

  it('utils.js does NOT (a server component must be able to call it)', () => {
    expect(directive.test(read('blazefire/utils.js'))).toBe(false)
  })

  it('index.js does NOT (marking the entry would break server utilities)', () => {
    expect(directive.test(read('blazefire/index.js'))).toBe(false)
  })
})
