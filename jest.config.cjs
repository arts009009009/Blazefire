'use strict'

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        // The package emits ESM (NodeNext), but Jest runs CJS. Tests compile
        // with a CJS override; source files keep .js-extension imports which
        // TS resolves back to the .ts sources.
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node',
          verbatimModuleSyntax: false,
          isolatedModules: true,
          types: ['node', 'jest'],
        },
      },
    ],
  },
}
