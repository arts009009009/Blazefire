/**
 * Package-root anchor — the single place that knows where this package lives.
 *
 * ESM-only by design (dist is ESM). The jest transform runs these sources as
 * CJS where `import.meta` is a parse-level error, so jest remaps this exact
 * module to a stub via moduleNameMapper (see jest.config.cjs) — tests never
 * parse this file.
 *
 * Layout: <root>/dist/package-root.js -> root is one directory up.
 */
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The blazefire package root — the anchor for dist/, package.json, assets. */
export const PACKAGE_ROOT: string = dirname(dirname(fileURLToPath(import.meta.url)))
