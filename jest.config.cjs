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
  // Keep suite output readable: swallow per-test console noise unless a test
  // fails (jest still shows output for failing tests).
  silent: true,
}
