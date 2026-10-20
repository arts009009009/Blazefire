/**
 * Tests for the server-safe half of the package entry (`blazefire/utils.js`).
 *
 * These run through babel-jest (see babel.config.cjs) so the shipped ESM
 * source is exercised directly, not a re-implementation.
 */

'use strict'

// The package's ESM sources are loaded through the same babel transform Jest
// applies to test files; import them at the top so failures surface as suite
// failures with a clear stack.
import {
  BLAZEFIRE_VERSION,
  FROSTFAST_VERSION,
  createBlazefireLogo,
  createCompiler,
  insertBlazefireStyles,
} from '../blazefire/utils.js'

const pkg = require('../package.json')

describe('version constants', () => {
  it('reports the installed package version', () => {
    expect(BLAZEFIRE_VERSION).toBe(pkg.version)
  })

  it('exposes a Frostfast compiler version', () => {
    expect(FROSTFAST_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

describe('insertBlazefireStyles', () => {
  afterEach(() => {
    delete global.document
  })

  it('is a no-op on the server (no document)', () => {
    expect(typeof document).toBe('undefined')
    expect(() => insertBlazefireStyles()).not.toThrow()
  })

  it('injects an idempotent <style> into document.head', () => {
    const appended = []
    const existing = []
    global.document = {
      getElementById: (id) => existing.find((el) => el.id === id) || null,
      createElement: () => ({ id: '', textContent: '' }),
      head: {
        appendChild: (el) => {
          existing.push(el)
          appended.push(el)
          return el
        },
      },
      addEventListener: () => {
        throw new Error('head exists — no DOMContentLoaded retry expected')
      },
    }

    insertBlazefireStyles()
    expect(appended).toHaveLength(1)
    expect(appended[0].id).toBe('blazefire-styles')
    expect(appended[0].textContent).toContain('--blazefire-cyan')

    insertBlazefireStyles() // second call must dedupe
    expect(appended).toHaveLength(1)
  })

  it('survives a missing document.head by retrying on DOM ready', () => {
    const existing = []
    let domReady = null
    global.document = {
      getElementById: (id) => existing.find((el) => el.id === id) || null,
      createElement: () => ({ id: '', textContent: '' }),
      head: null,
      addEventListener: (event, handler) => {
        if (event === 'DOMContentLoaded') domReady = handler
      },
    }

    expect(() => insertBlazefireStyles()).not.toThrow()
    expect(existing).toHaveLength(0) // nothing appended yet — head was null
    expect(typeof domReady).toBe('function')

    // Simulate DOM ready with the head now present.
    global.document.head = {
      appendChild: (el) => existing.push(el),
    }
    domReady()
    expect(existing).toHaveLength(1)
    expect(existing[0].id).toBe('blazefire-styles')
  })
})

describe('createBlazefireLogo', () => {
  it('defaults to a 40px self-contained data URI image', () => {
    const html = createBlazefireLogo()
    expect(html).toContain('src="data:image/svg+xml,')
    expect(html).toContain('width="40"')
    expect(html).toContain('height="40"')
    expect(html).toContain('alt="Blazefire"')
  })

  it('honours numeric and numeric-string sizes', () => {
    expect(createBlazefireLogo(64)).toContain('width="64"')
    expect(createBlazefireLogo('64')).toContain('width="64"')
    expect(createBlazefireLogo(0)).toContain('width="40"') // 0 → default
  })

  it('falls back to the default for non-numeric input', () => {
    for (const bad of [
      undefined,
      null,
      NaN,
      -5,
      'huge',
      {},
      Symbol('size'),
      Object.create(null),
      {
        valueOf() {
          throw new Error('cannot convert')
        },
      },
    ]) {
      expect(createBlazefireLogo(bad)).toContain('width="40"')
    }
  })

  it('cannot be used to inject markup (size is attribute-escaped by type)', () => {
    const attempts = [
      '"><script>alert(1)</script>',
      '40" onerror="alert(1)',
      "' onmouseover='alert(1)",
    ]
    for (const attack of attempts) {
      const html = createBlazefireLogo(attack)
      expect(html).not.toContain('<script')
      expect(html).not.toContain('onerror')
      expect(html).not.toContain('onmouseover')
      expect(html).toContain('width="40"')
    }
  })
})

describe('createCompiler', () => {
  it('returns the documented defaults with no arguments', () => {
    const c = createCompiler()
    expect(c.version).toBe(FROSTFAST_VERSION)
    expect(c.options.jsc.parser).toEqual({
      syntax: 'typescript',
      tsx: true,
    })
    expect(c.options.jsc.transform.react.runtime).toBe('automatic')
    expect(c.options.module.type).toBe('es6')
  })

  it('merges one level deep: a parser override keeps the JSX transform', () => {
    const c = createCompiler({
      jsc: { parser: { syntax: 'ecmascript' } },
    })
    expect(c.options.jsc.parser).toEqual({ syntax: 'ecmascript' })
    expect(c.options.jsc.transform.react.runtime).toBe('automatic')
  })

  it('merges one level deep: a module override keeps the default type', () => {
    const c = createCompiler({ module: { type: 'commonjs' } })
    expect(c.options.module.type).toBe('commonjs')
    expect(c.options.jsc.parser.tsx).toBe(true)
  })

  it('preserves keys it does not know about (regression)', () => {
    // These used to be silently deleted by the merge.
    const c = createCompiler({
      jsc: { target: 'es2017', externalHelpers: true },
      module: { type: 'commonjs', noInterop: false },
      filename: 'app.tsx',
    })
    expect(c.options.jsc.target).toBe('es2017')
    expect(c.options.jsc.externalHelpers).toBe(true)
    expect(c.options.module.noInterop).toBe(false)
    expect(c.options.filename).toBe('app.tsx')
    // …while still applying the defaults for missing keys.
    expect(c.options.jsc.parser).toEqual({ syntax: 'typescript', tsx: true })
    expect(c.options.jsc.transform.react.runtime).toBe('automatic')
  })

  it('tolerates null jsc/module and null options', () => {
    expect(createCompiler(null).options.module.type).toBe('es6')
    const c = createCompiler({ jsc: null, module: null })
    expect(c.options.jsc.parser.syntax).toBe('typescript')
    expect(c.options.module.type).toBe('es6')
  })

  it('transform() resolves with the code unchanged (documented passthrough)', async () => {
    const c = createCompiler()
    const code = 'const x: number = 1'
    await expect(c.transform(code, 'file.tsx')).resolves.toEqual({ code })
  })
})
