/**
 * Blazefire Frostfast Compiler Entry Point (JS)
 */

import { transform } from './swc/index.js'

export var COMPILER_VERSION = '1.0.0'

export function createCompiler(config) {
  config = config || {}
  var defaults = {
    target: 'es2020',
    module: 'es6',
    jsx: 'react-jsx',
    strict: true,
  }

  var merged = Object.assign({}, defaults, config)

  return {
    config: merged,
    version: COMPILER_VERSION,
    compile: async function (code, filename) {
      if (typeof window !== 'undefined') {
        throw new Error(
          'Frostfast transforms are only available in a Node.js runtime.'
        )
      }
      const options = {
        jsc: {
          target: merged.target,
          parser: { syntax: 'typescript', tsx: true },
          transform: {
            react: {
              runtime: merged.jsx === 'react' ? 'classic' : 'automatic',
            },
          },
        },
        module: { type: merged.module },
      }
      if (filename) options.filename = filename
      const result = await transform(code, options)
      return { code: result.code, error: null }
    },
  }
}
