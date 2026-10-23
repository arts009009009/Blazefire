/**
 * Version constants — the single in-code source for advertised versions.
 *
 * The ONLY other source is package.json (enforced by __tests__/guards.test.ts,
 * which fails if this file drifts from the manifest). This replaces v1's
 * `process.env.__NEXT_VERSION`, which was read in ~25 places and never
 * assigned, producing spurious binding-version warnings and undefined cache
 * keys (spec H-18).
 */

export const BLAZEFIRE_VERSION = '2.0.0'

/** Version of the Frostfast compiler core this runtime is contract-tested against. */
export const FROSTFAST_VERSION = '2.0.0'
