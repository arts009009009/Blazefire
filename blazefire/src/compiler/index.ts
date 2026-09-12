/**
 * Blazefire Frostfast Compiler
 * 
 * This module provides the core compilation capabilities for the Blazefire framework.
 * It includes SWC-based transformations and Turbopack bundling.
 */

import type { CompilerResult } from './compiler';

export { CompilerResult };
export { runCompiler, closeCompiler } from './compiler';

// SWC Compiler exports
export * from './swc';

// Turbopack exports  
export * from './turbopack';

/**
 * Frostfast Compiler Version
 */
export const FROSTFAST_VERSION = '1.0.0';

/**
 * Default compiler options for Blazefire
 */
export const defaultCompilerOptions = {
  // SWC options
  jsc: {
    parser: {
      syntax: 'typescript',
      tsx: true,
      decorators: true,
    },
    transform: {
      react: {
        runtime: 'automatic',
      },
    },
  },
  module: {
    type: 'es6',
  },
};

/**
 * Create a Blazefire compiler instance
 */
export function createCompiler(options?: Record<string, unknown>) {
  const mergedOptions = {
    ...defaultCompilerOptions,
    ...options,
  };

  return {
    options: mergedOptions,
    version: FROSTFAST_VERSION,
  };
}
