/**
 * Activation scanner — the pure rewrite engine behind postinstall AND the
 * CLI (one implementation, v1 parity).
 */
import {
  CJS_REQUIRE,
  ESM_IMPORT,
  findTopLevel,
  plan,
  rewrite,
  SNIPPET,
} from '../src/postinstall/scanner'

const ESM_CONFIG = `/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: { formats: ['image/avif', 'image/webp'] },
}

export default nextConfig
`

const CJS_CONFIG = `const nextConfig = { reactStrictMode: true }
module.exports = nextConfig
`

describe('scanner.plan / scanner.rewrite', () => {
  it('wraps a plain ESM default export', () => {
    const result = rewrite(ESM_CONFIG)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.code).toContain(ESM_IMPORT)
    expect(result.code).toContain('export default blazefire(nextConfig)')
  })

  it('wraps a plain CJS module.exports', () => {
    const result = rewrite(CJS_CONFIG)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.code).toContain(CJS_REQUIRE)
    expect(result.code).toContain('module.exports = blazefire(nextConfig)')
  })

  it('is idempotent — activating twice produces no double wrap', () => {
    const once = rewrite(ESM_CONFIG)
    expect(once.ok).toBe(true)
    if (!once.ok) return
    const twice = rewrite(once.code)
    expect(twice.ok).toBe(false) // second default export detected
  })

  it('wraps an inline object literal', () => {
    const result = rewrite('export default { reactStrictMode: true };\n')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.code).toContain('export default blazefire({ reactStrictMode: true });')
  })

  it('wraps a function-style config', () => {
    const result = rewrite('export default () => ({ reactStrictMode: true })\n')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.code).toContain('blazefire(() => ({ reactStrictMode: true }))')
  })

  it('refuses a file with no default export', () => {
    expect(rewrite('const x = 1\n').ok).toBe(false)
  })

  it('refuses `export default class`', () => {
    expect(rewrite('export default class Foo {}\n').ok).toBe(false)
  })

  it('refuses `export { x as default }`', () => {
    expect(rewrite('const c = {}\nexport { c as default }\n').ok).toBe(false)
  })

  it('keeps the shebang line above the inserted import', () => {
    const result = rewrite('#!/usr/bin/env node\nexport default { a: 1 }\n')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const lines = result.code.split('\n')
    expect(lines[0]).toBe('#!/usr/bin/env node')
    expect(lines[1]).toBe(ESM_IMPORT)
  })

  it('preserves CRLF line endings', () => {
    const result = rewrite('const c = {}\r\nmodule.exports = c\r\n')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.code).toContain(`\r\n${CJS_REQUIRE}\r\n`)
  })

  it('does not trip on strings, comments, or template literals', () => {
    const config = `const note = "export default fake"
// export default alsoFake
const tpl = \`\${note} export default\`
const config = { note, tpl }
export default config
`
    const result = rewrite(config)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Exactly one wrapped default export — the real one at the end.
    expect(result.code.match(/export default blazefire\(/g)).toHaveLength(1)
    expect(result.code).toContain('export default fake') // untouched string
  })

  it('finds top-level tokens only (ignores nested ones)', () => {
    const hit = findTopLevel('const a = { b: "export default" }\nexport default a\n', [
      'export default',
    ])
    expect(hit?.index).toBeGreaterThan(0)
    expect(hit?.index).toBe('const a = { b: "export default" }\n'.length)
  })

  it('SNIPPET matches the emitted import + wrap shape', () => {
    expect(SNIPPET).toContain(ESM_IMPORT)
    expect(SNIPPET).toContain('blazefire(nextConfig)')
  })
})

describe('scanner edge cases (bulletproofing)', () => {
  it('does not inject a duplicate ESM binding when the import already exists', () => {
    // The half-paste state: our manual advice says "add this import", the
    // wrap step was never done. A second `import blazefire` = SyntaxError.
    const config = `import blazefire from "blazefire/plugin";
const nextConfig = { reactStrictMode: true }
export default nextConfig
`
    const result = rewrite(config)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.code.match(/import blazefire from/g)).toHaveLength(1)
    expect(result.code).toContain('export default blazefire(nextConfig)')
  })

  it('does not inject a duplicate CJS binding when the require already exists', () => {
    const config = `const blazefire = require("blazefire/plugin");
const nextConfig = { reactStrictMode: true }
module.exports = nextConfig
`
    const result = rewrite(config)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.code.match(/require\("blazefire\/plugin"\)/g)).toHaveLength(1)
    expect(result.code).toContain('module.exports = blazefire(nextConfig)')
  })

  it('still inserts the import when a similarly-named binding exists', () => {
    const config = `import blazefireExtended from "./helper"
const nextConfig = { a: 1 }
export default nextConfig
`
    const result = rewrite(config)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.code).toContain(ESM_IMPORT)
    expect(result.code).toContain('export default blazefire(nextConfig)')
  })

  it('refuses a config already applied through an intermediate const', () => {
    const config = `import blazefire from "blazefire/plugin"
const nextConfig = blazefire({ reactStrictMode: true })
export default nextConfig
`
    const result = rewrite(config)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/already wrapped/)
  })

  it('refuses `export defaultConfig` (named export, not a default one)', () => {
    const result = rewrite('const defaultConfig = { a: 1 }\nexport defaultConfig\n')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/no top-level/)
  })

  it('refuses a file that only assigns module.exports properties', () => {
    // Wrapping would emit `blazefire(.env = …)` — a SyntaxError injection.
    const result = rewrite('module.exports.env = { a: 1 }\n')
    expect(result.ok).toBe(false)
  })

  it('skips a module.exports look-alike and wraps the real assignment', () => {
    const config = `module.exports.loadConfig = () => ({})
module.exports = { reactStrictMode: true }
`
    const result = rewrite(config)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.code).toContain('module.exports = blazefire({ reactStrictMode: true })')
    expect(result.code).not.toContain('blazefire(.loadConfig')
  })

  it('keeps a UTF-8 BOM in front of the wrapped config', () => {
    const result = rewrite('\uFEFFexport default { a: 1 }\n')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.code.startsWith('\uFEFF')).toBe(true)
    expect(result.code).toContain('export default blazefire({ a: 1 })')
  })

  it('refuses an empty or comment-only config with a clear reason', () => {
    expect(rewrite('').ok).toBe(false)
    expect(rewrite('// nothing here yet\n').ok).toBe(false)
  })
})
