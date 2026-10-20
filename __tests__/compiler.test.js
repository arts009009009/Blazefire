'use strict'

const mockTransform = jest.fn()

jest.mock('../blazefire/src/compiler/swc/index.js', () => ({
  transform: (...args) => mockTransform(...args),
}))

import {
  COMPILER_VERSION,
  createCompiler,
} from '../blazefire/src/compiler/index.js'

describe('Frostfast compiler', () => {
  beforeEach(() => {
    mockTransform.mockReset()
  })

  it('transforms TypeScript and JSX with the configured SWC options', async () => {
    mockTransform.mockResolvedValue({ code: 'const element = jsx("div", {});' })
    const compiler = createCompiler({
      target: 'es2022',
      module: 'commonjs',
      jsx: 'react',
    })

    await expect(
      compiler.compile('const element = <div />', 'src/page.tsx')
    ).resolves.toEqual({
      code: 'const element = jsx("div", {});',
      error: null,
    })
    expect(compiler.version).toBe(COMPILER_VERSION)
    expect(compiler.config).toEqual({
      target: 'es2022',
      module: 'commonjs',
      jsx: 'react',
      strict: true,
    })
    expect(mockTransform).toHaveBeenCalledWith(
      'const element = <div />',
      {
        jsc: {
          target: 'es2022',
          parser: { syntax: 'typescript', tsx: true },
          transform: { react: { runtime: 'classic' } },
        },
        module: { type: 'commonjs' },
        filename: 'src/page.tsx',
      }
    )
  })

  it('defaults to automatic JSX runtime and preserves SWC errors', async () => {
    const failure = new Error('invalid TypeScript source')
    mockTransform.mockRejectedValue(failure)
    const compiler = createCompiler()

    await expect(compiler.compile('const =')).rejects.toBe(failure)
    expect(mockTransform).toHaveBeenCalledWith('const =', {
      jsc: {
        target: 'es2020',
        parser: { syntax: 'typescript', tsx: true },
        transform: { react: { runtime: 'automatic' } },
      },
      module: { type: 'es6' },
    })
  })

  it('rejects transforms in a browser runtime', async () => {
    const originalWindow = global.window
    global.window = {}
    try {
      await expect(createCompiler().compile('const value = 1')).rejects.toThrow(
        'Frostfast transforms are only available in a Node.js runtime.'
      )
    } finally {
      if (originalWindow === undefined) delete global.window
      else global.window = originalWindow
    }
  })
})
