/**
 * Jest only runs this package's own suites (`__tests__/**`). Without this
 * config jest would walk the entire repo, including the vendored Next.js /
 * Turbopack trees under `packages/`, `turbopack/`, and `test/`, which contain
 * thousands of test files that do not belong to this package.
 */

'use strict'

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  testMatch: ['**/*.test.js'],
  // Quiet the CLI's "blazefire:" progress logs without hiding real output.
  setupFilesAfterEnv: ['<rootDir>/jest.setup.cjs'],
}
