/**
 * Jest stub for src/package-root.ts.
 *
 * The real module anchors on import.meta (ESM-only); jest's CJS transform
 * cannot parse that, so jest.config.cjs maps `./package-root.js` here.
 * This file lives at <root>/__tests__/helpers/, so the package root is two
 * directories up — matching what the real module computes in dist/.
 */
import { join } from 'node:path'

export const PACKAGE_ROOT: string = join(__dirname, '..', '..')
