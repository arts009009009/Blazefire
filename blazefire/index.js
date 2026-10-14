/**
 * Blazefire Framework - SSR-Safe Entry Point
 * Powered by Frostfast compiler
 *
 * The package's single entry point re-exports two halves:
 *
 *   - `utils.js`   — version constants, style injection, logo, compiler.
 *                    Usable from a Server Component or during `next build`.
 *   - `provider.js`— the React context (`'use client'`), so
 *                    `<BlazefireProvider>` / `useBlazefire()` render correctly
 *                    even when they are reached from a Server Component.
 *
 * Keeping them in separate modules is deliberate: a `'use client'` directive
 * here would make *every* export a client reference, which would break a plain
 * `insertBlazefireStyles()` call in a Server Component.
 */

import {
  BLAZEFIRE_VERSION,
  createBlazefireLogo,
  createCompiler,
  insertBlazefireStyles,
} from './utils.js'
import { BlazefireProvider, useBlazefire } from './provider.js'

export {
  BLAZEFIRE_VERSION,
  FROSTFAST_VERSION,
  insertBlazefireStyles,
  createBlazefireLogo,
  createCompiler,
} from './utils.js'

export { BlazefireProvider, useBlazefire } from './provider.js'

// ===== Default Export =====
var Blazefire = {
  version: BLAZEFIRE_VERSION,
  createCompiler: createCompiler,
  insertBlazefireStyles: insertBlazefireStyles,
  createBlazefireLogo: createBlazefireLogo,
  BlazefireProvider: BlazefireProvider,
  useBlazefire: useBlazefire,
}

export default Blazefire
