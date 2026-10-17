/**
 * Tests for the Turbopack injection loader (`blazefire/runtime/turbopack-loader.cjs`).
 *
 * The loader prepends a side-effect `require()` of the Blazefire runtime to
 * Next's client bootstrap. Loaders must be synchronous and return a string.
 */

'use strict'

const path = require('path')
const blazefireLoader = require('../blazefire/runtime/turbopack-loader.cjs')

const INJECT = path.join(__dirname, '..', 'blazefire', 'runtime', 'inject.cjs')

/** A minimal loader context (webpack/turbopack `this`). */
function ctx({ options = { injectPath: INJECT }, resourcePath } = {}) {
  return {
    getOptions: () => options,
    resourcePath:
      resourcePath === undefined
        ? '/app/node_modules/next/dist/client/next.js'
        : resourcePath,
  }
}

describe('blazefireLoader', () => {
  it('prepends a side-effect require of the runtime with the idempotency marker', () => {
    const out = blazefireLoader.call(ctx(), 'console.log("boot")')
    expect(out).toMatch(/^require\("(.+)blazefire[\\/]runtime[\\/]inject\.cjs"\); \/\* blazefire-injected \*\//)
    expect(out).toContain('console.log("boot")')
  })

  it('emits a path relative to the transformed file (resolution stays local)', () => {
    const out = blazefireLoader.call(ctx(), 'src')
    // From /app/node_modules/next/dist/client up to this repo's inject.cjs —
    // must never be an absolute path (turbopack rejects absolute imports that
    // escape the project root) and must not contain backslashes.
    const firstLine = out.split('\n')[0]
    expect(firstLine).not.toMatch(/require\("\/|require\("[A-Za-z]:/)
    expect(firstLine).not.toContain('\\')
  })

  it('is idempotent — re-running the loader does not double-inject', () => {
    const once = blazefireLoader.call(ctx(), 'src')
    const twice = blazefireLoader.call(ctx(), once)
    expect(twice).toBe(once)
    expect(twice.match(/blazefire-injected/g)).toHaveLength(1)
  })

  it('passes source through untouched when no injectPath option is given', () => {
    const out = blazefireLoader.call(ctx({ options: {} }), 'original source')
    expect(out).toBe('original source')
  })

  it('passes through when the source already carries the marker', () => {
    const marked = 'x /* blazefire-injected */ y'
    expect(blazefireLoader.call(ctx(), marked)).toBe(marked)
  })

  it('falls back to a cwd-relative path when resourcePath is missing', () => {
    const out = blazefireLoader.call(ctx({ resourcePath: null }), 'src')
    const firstLine = out.split('\n')[0]
    // relative (starts with ./), never absolute
    expect(firstLine).toMatch(/require\("\.\//)
  })

  it('does not throw on a non-string source (coerces it into the result)', () => {
    // Only string sources are ever passed by turbopack, but the guard must not
    // throw: the buffer is coerced into the emitted string.
    let result
    expect(() => {
      result = blazefireLoader.call(ctx(), Buffer.from('bytes'))
    }).not.toThrow()
    expect(typeof result).toBe('string')
    expect(result).toContain('bytes')
    expect(result).toContain('blazefire-injected')
  })
})
