'use strict'

const { createRequire } = require('module')
const path = require('path')

import { createSwcBindings } from '../blazefire/src/compiler/swc/index.js'

const requireFromProject = createRequire(
  path.join(process.cwd(), 'package.json')
)
let hasNextSwc = true
try {
  requireFromProject.resolve('next/dist/build/swc')
} catch (_) {
  hasNextSwc = false
}

describe('Next.js SWC adapter', () => {
  it('runs synchronous transforms through the installed backend', () => {
    const transformSync = jest.fn(() => ({ code: 'compiled' }))
    const backend = { transformSync }
    const bindings = createSwcBindings(() => backend)
    const options = { filename: 'src/page.tsx' }

    expect(bindings.transformSync('source', options)).toEqual({
      code: 'compiled',
    })
    expect(transformSync).toHaveBeenCalledWith('source', options)
  })

  it('loads the backend before asynchronous transforms', async () => {
    const calls = []
    const backend = {
      loadBindings: jest.fn(async () => calls.push('load')),
      transform: jest.fn(async () => {
        calls.push('transform')
        return { code: 'compiled' }
      }),
    }
    const bindings = createSwcBindings(() => backend)
    const options = { jsc: { target: 'es2022' } }

    await expect(bindings.transform('source', options)).resolves.toEqual({
      code: 'compiled',
    })
    expect(calls).toEqual(['load', 'transform'])
    expect(backend.transform).toHaveBeenCalledWith('source', options)
  })

  it('reports a backend that does not expose the requested transform', () => {
    const bindings = createSwcBindings(() => ({}))

    expect(() => bindings.transformSync('source')).toThrow(
      'The installed Next.js SWC backend has no transformSync API.'
    )
    return expect(bindings.transform('source')).rejects.toThrow(
      'The installed Next.js SWC backend has no transform API.'
    )
  })

  it('does not hide transform failures from the backend', async () => {
    const failure = new Error('SWC failed')
    const bindings = createSwcBindings(() => ({
      transform: async () => {
        throw failure
      },
    }))

    await expect(bindings.transform('source')).rejects.toBe(failure)
  })

  const testWithNextSwc = hasNextSwc ? it : it.skip
  testWithNextSwc(
    'transforms TypeScript and JSX with the real Next.js SWC backend',
    async () => {
      const bindings = createSwcBindings()
      const result = await bindings.transform(
        'export const Page = () => <main>{42 as number}</main>',
        {
          filename: 'page.tsx',
          jsc: {
            parser: { syntax: 'typescript', tsx: true },
            transform: { react: { runtime: 'automatic' } },
          },
          module: { type: 'es6' },
        }
      )

      expect(result.code).not.toContain(' as number')
      expect(result.code).not.toContain('<main>')
      expect(result.code).toMatch(/jsx|jsxs/)
    }
  )

  if (!hasNextSwc) {
    it('reports the missing optional Next.js backend explicitly', async () => {
      await expect(createSwcBindings().transform('source')).rejects.toThrow(
        'Frostfast transforms require Next.js to be installed in the project.'
      )
    })
  }
})
