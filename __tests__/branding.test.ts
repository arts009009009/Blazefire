/**
 * Branding engine (H-18): ONE source of truth for tokens, labels, headers,
 * and the emblem.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  BLAZEFIRE_BRANDING,
  blazefireOverlayStyles,
  blazefireStyles,
  flameDataUri,
  logoDataUri,
} from '../src/branding'
import { LOGO_DATA_URI } from '../src/generated/logo-data'
import { BLAZEFIRE_VERSION, FROSTFAST_VERSION } from '../src/version'

describe('branding', () => {
  it('carries the v1 Frostfast headers verbatim', () => {
    expect(BLAZEFIRE_BRANDING.headers.poweredBy).toBe('Blazefire Framework')
    expect(BLAZEFIRE_BRANDING.headers.compiler).toBe(`Frostfast v${FROSTFAST_VERSION}`)
  })

  it('versions from the single version module', () => {
    expect(BLAZEFIRE_BRANDING.version).toBe(BLAZEFIRE_VERSION)
    expect(BLAZEFIRE_BRANDING.compilerVersion).toBe(FROSTFAST_VERSION)
  })

  it('keeps every label match non-global (a /g/ regex is stateful under .test())', () => {
    for (const label of BLAZEFIRE_BRANDING.labels) {
      expect(label.match.global).toBe(false)
    }
  })

  it('emits document theme CSS containing the colour tokens', () => {
    const css = blazefireStyles()
    expect(css).toContain('--blazefire-cyan: #00ffff')
    expect(css).toContain(BLAZEFIRE_BRANDING.topBarGradient)
  })

  it('emits overlay CSS with logo replacement inside shadow roots', () => {
    const css = blazefireOverlayStyles()
    expect(css).toContain(':host')
    expect(css).toContain('#next-logo > svg')
    expect(css).toContain('.code-frame-icon > svg')
  })

  it('uses the canonical PNG data URI (single stored logo, generated once)', () => {
    expect(LOGO_DATA_URI.startsWith('data:image/png;base64,')).toBe(true)
    expect(logoDataUri()).toBe(LOGO_DATA_URI)
  })

  it('keeps exactly one stored PNG at the repo root', () => {
    expect(existsSync(join(__dirname, '..', 'blazefire-logo.png'))).toBe(true)
    // The only other copy is the gitignored generated data form.
    expect(existsSync(join(__dirname, '..', 'src', 'generated', 'logo-data.ts'))).toBe(true)
  })

  it('falls back to the SVG flame when the PNG is absent', () => {
    const custom = { ...BLAZEFIRE_BRANDING, logo: { ...BLAZEFIRE_BRANDING.logo } }
    const uri = flameDataUri(custom)
    expect(uri.startsWith('data:image/svg+xml,')).toBe(true)
    expect(decodeURIComponent(uri)).toContain('#ff8800') // first gradient stop
  })

  it('produces finite gradient offsets even for a single stop', () => {
    const uri = flameDataUri({
      ...BLAZEFIRE_BRANDING,
      logo: { ...BLAZEFIRE_BRANDING.logo, gradient: ['#ff006e'] },
    })
    expect(uri).not.toContain('NaN')
  })
})
