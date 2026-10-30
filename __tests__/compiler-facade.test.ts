/**
 * createCompiler — the isModule heuristic at the transform boundary.
 *
 * A shebang, license banner, or lint directive before the first import is
 * still ESM: handing `isModule: false` to the native parser makes it reject
 * top-level import/export on perfectly valid files.
 */
import { createCompiler } from '../src/compiler'
import type { FrostfastBinding } from '../src/compiler/native-contract'

function makeBinding(): { calls: Array<{ isModule: boolean }>; binding: FrostfastBinding } {
  const calls: Array<{ isModule: boolean }> = []
  const binding = {
    transform: (_source: unknown, isModule: boolean) => {
      calls.push({ isModule })
      return Promise.resolve({ code: '' })
    },
    transformSync: (_source: unknown, isModule: boolean) => {
      calls.push({ isModule })
      return { code: '' }
    },
  }
  return { calls, binding: binding as unknown as FrostfastBinding }
}

describe('isModuleSource (transform boundary)', () => {
  it('treats ESM preceded by a shebang, banner comment, or lint directive as a module', async () => {
    const { calls, binding } = makeBinding()
    const compiler = createCompiler(binding)

    const esmCases = [
      '#!/usr/bin/env node\nimport x from "y"\n',
      '/* Copyright (c) 2026 */\nexport default 1\n',
      '// eslint-disable-next-line\nimport "polyfill"\n',
      '\n\nimport { a } from "b"\n',
    ]
    for (const code of esmCases) {
      await compiler.transform(code)
    }

    expect(calls).toHaveLength(esmCases.length)
    expect(calls.every((call) => call.isModule)).toBe(true)
  })

  it('still passes real scripts as scripts (including later-line red herrings)', async () => {
    const { calls, binding } = makeBinding()
    const compiler = createCompiler(binding)

    const scriptCases = [
      'const x = 1\n',
      'const s = "import fake from \\"x\\""\n',
      'module.exports = {}\n',
      'const x = 1\n// import commented out\n',
    ]
    for (const code of scriptCases) {
      await compiler.transform(code)
    }

    expect(calls).toHaveLength(scriptCases.length)
    expect(calls.every((call) => !call.isModule)).toBe(true)
  })

  it('honours explicit parser/module options over the heuristic', async () => {
    const { calls, binding } = makeBinding()
    const compiler = createCompiler(binding)

    await compiler.transform('const x = 1', { module: { type: 'es6' } })
    await compiler.transform('const x = 1', { jsc: { parser: { syntax: 'typescript' } } })

    expect(calls).toHaveLength(2)
    expect(calls.every((call) => call.isModule)).toBe(true)
  })

  it('detects the same way on the sync path', () => {
    const { calls, binding } = makeBinding()
    const compiler = createCompiler(binding)

    compiler.transformSync('#!/usr/bin/env node\nexport const a = 1\n')
    compiler.transformSync('const a = 1\n')

    expect(calls.map((call) => call.isModule)).toEqual([true, false])
  })
})
