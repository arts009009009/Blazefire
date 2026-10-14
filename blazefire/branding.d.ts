/**
 * Types for `blazefire/branding` (the CJS single source of truth consumed by
 * the plugin, the runtime injector, and the components).
 */

export interface BlazefireBrandLabel {
  /** CSS selector locating the node inside Next's dev overlay. */
  selector: string
  /** Pattern matched against the node's text (never global — see branding.cjs). */
  match: RegExp
  /** Replacement text (fed to `String.replace`). */
  replace: string
  /** Optional attribute to rewrite instead of the text node. */
  attribute?: string
  /** Optional title/tooltip applied alongside the rewrite. */
  title?: string
}

export interface BlazefireBrandLogo {
  selectors: string[]
  /** Path of the emblem asset, relative to the package's `blazefire/` dir. */
  asset: string
  /** SVG path used when the asset is unavailable. */
  path: string
  gradient: string[]
  /** Optional per-selector `background-size` overrides (default: `contain`). */
  sizes?: Record<string, string>
}

export interface BlazefireBrandColors {
  cyan: string
  magenta: string
  red: string
  green: string
  orange: string
  background: string
  surface: string
  text: string
}

export interface BlazefireBranding {
  name: string
  compiler: string
  version: string
  compilerVersion: string
  headers: {
    poweredBy: string
    compiler: string
  }
  banner: string
  labels: BlazefireBrandLabel[]
  logo: BlazefireBrandLogo
  colors: BlazefireBrandColors
  topBarGradient: string
}

export const BLAZEFIRE_BRANDING: BlazefireBranding

export function blazefireStyles(branding?: BlazefireBranding): string
export function blazefireOverlayStyles(branding?: BlazefireBranding): string
export function flameDataUri(branding?: BlazefireBranding): string
export function logoDataUri(branding?: BlazefireBranding): string
