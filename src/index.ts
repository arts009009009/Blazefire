/**
 * blazefire v2 — public API.
 *
 * A pure App Router, Turbopack/Frostfast-first framework runtime:
 *  - no webpack build tree (spec H-01)
 *  - no pages router (spec H-03)
 *  - no hand-mirrored JS/TS source pairs (spec H-04): everything under src/
 *    is TypeScript, compiled once into dist/
 */

export { default as blazefire, default } from './plugin.js'
export { buildConfig, buildTurbopackRules } from './plugin.js'

export {
  BLAZEFIRE_BRANDING,
  blazefireStyles,
  blazefireOverlayStyles,
  flameDataUri,
  logoDataUri,
} from './branding.js'
export type { Branding, BrandLabel } from './branding.js'

export { BLAZEFIRE_VERSION, FROSTFAST_VERSION } from './version.js'

export { createCompiler } from './compiler/index.js'
export type { CompilerInstance, TransformOptions, TransformResult } from './compiler/index.js'

export {
  DEFAULTS,
  mergeConfigs,
  isNextConfig,
  serializeProjectConfig,
  ConfigChangeGate,
} from './config/index.js'
export type {
  BlazefireOptions,
  NextConfigLike,
  HeaderRule,
  TurbopackRules,
  SerializedProjectConfig,
} from './config/index.js'
