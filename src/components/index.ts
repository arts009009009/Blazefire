/**
 * React component surface (v1 parity — v1 shipped BlazefireLogo and the
 * error-overlay pieces as components). Pure presentation: no framework
 * internals, safe to import from any App Router component tree.
 */
export { BlazefireLogo, BlazefireDevToolsIndicator } from './blazefire-logo.js'
export type {
  BlazefireLogoProps,
  BlazefireDevToolsIndicatorProps,
} from './blazefire-logo.js'
export {
  BlazefireErrorHeader,
  BlazefireErrorOverlay,
} from './error-overlay-layout.js'
export type {
  BlazefireErrorHeaderProps,
  BlazefireErrorOverlayProps,
} from './error-overlay-layout.js'
