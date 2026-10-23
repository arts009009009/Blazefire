'use strict'

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  testMatch: ['**/*.test.ts'],
  // Source files use NodeNext-style `./x.js` specifiers; map them back to the
  // .ts sources so jest's resolver (running on the CJS transform) finds them.
  // package-root is special: the real module anchors on import.meta (ESM), so
  // jest gets a CJS-safe stub instead.
  moduleNameMapper: {
    '^(\\.{1,2}/)package-root\\.js$': '<rootDir>/__tests__/helpers/package-root.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
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
