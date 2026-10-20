/**
 * Blazefire Frostfast Compiler Entry Point
 */

import { transform } from './swc/index.js'

export interface CompilerConfig {
  target?: string
  module?: string
  jsx?: string
  strict?: boolean
}

export const COMPILER_VERSION = '1.0.0'

export function createCompiler(config: CompilerConfig = {}) {
  const defaults: CompilerConfig = {
    target: 'es2020',
    module: 'es6',
    jsx: 'react-jsx',
    strict: true,
  }

  return {
    config: { ...defaults, ...config },
    version: COMPILER_VERSION,
    async compile(code: string, filename?: string) {
      if (typeof window !== 'undefined') {
        throw new Error(
          'Frostfast transforms are only available in a Node.js runtime.'
        )
      }
      const options = {
        jsc: {
          target: config.target,
          parser: { syntax: 'typescript', tsx: true },
          transform: {
            react: { runtime: config.jsx === 'react' ? 'classic' : 'automatic' },
          },
        },
        module: { type: config.module },
        ...(filename ? { filename } : {}),
      }
      const result = await transform(code, options)
      return { code: result.code, error: null }
    },
  }
}
