/**
 * Tests for `blazefire/branding.cjs` — the single source of truth every other
 * module (plugin, runtime injector, overlay styles) reads from.
 */

'use strict'

const {
  BLAZEFIRE_BRANDING,
  blazefireStyles,
  blazefireOverlayStyles,
  flameDataUri,
  logoDataUri,
} = require('../blazefire/branding.cjs')

const pkg = require('../package.json')

describe('BLAZEFIRE_BRANDING shape', () => {
  it('carries the identity fields', () => {
    expect(BLAZEFIRE_BRANDING.name).toBe('Blazefire')
    expect(BLAZEFIRE_BRANDING.compiler).toBe('Frostfast')
    expect(BLAZEFIRE_BRANDING.version).toBe(pkg.version)
    expect(BLAZEFIRE_BRANDING.compilerVersion).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('carries response headers and a banner', () => {
    expect(BLAZEFIRE_BRANDING.headers.poweredBy).toBe('Blazefire Framework')
    expect(BLAZEFIRE_BRANDING.headers.compiler).toMatch(/^Frostfast v/)
    expect(BLAZEFIRE_BRANDING.banner).toContain('Blazefire Runtime v')
  })

  it('carries colours and a logo definition', () => {
    expect(typeof BLAZEFIRE_BRANDING.colors).toBe('object')
    expect(Object.keys(BLAZEFIRE_BRANDING.colors).length).toBeGreaterThan(0)
    expect(typeof BLAZEFIRE_BRANDING.topBarGradient).toBe('string')
    expect(Array.isArray(BLAZEFIRE_BRANDING.logo.gradient)).toBe(true)
    expect(typeof BLAZEFIRE_BRANDING.logo.path).toBe('string')
  })
})

describe('blazefireStyles() (document theme)', () => {
  const css = blazefireStyles()

  it('is a non-empty stylesheet with the brand tokens', () => {
    expect(typeof css).toBe('string')
    expect(css).toContain(':root')
    expect(css).toContain('--blazefire-cyan')
    expect(css).toContain('--blazefire-magenta')
    expect(css).toContain('body::before')
  })
})

describe('blazefireOverlayStyles() (shadow-root overlay theme)', () => {
  const css = blazefireOverlayStyles()

  it('is a non-empty stylesheet that rebrands the Next overlay', () => {
    expect(typeof css).toBe('string')
    expect(css.length).toBeGreaterThan(1000)
    // hides / repaints Next's own mark and carries the baked emblem
    expect(css).toContain('#next-logo')
    expect(css).toContain('data:image')
  })
})

describe('labels (literal text rewritten in the DOM)', () => {
  const labels = BLAZEFIRE_BRANDING.labels

  it('covers the version checker, bundler pill and dev-tools button', () => {
    const selectors = labels.map((l) => l.selector)
    expect(selectors).toContain('[data-nextjs-version-checker]')
    expect(selectors).toContain('.turbopack-text')
    expect(selectors).toContain('button[aria-label*="Dev Tools"]')
  })

  it('every match/replace pair is well-formed', () => {
    for (const label of labels) {
      expect(label.match).toBeInstanceOf(RegExp)
      expect(typeof label.replace).toBe('string')
    }
  })

  it('no match regex is global (a /g regex makes .test() stateful)', () => {
    // The runtime calls L.match.test() per element; a global regex would
    // alternate between matching and not across calls.
    for (const label of labels) {
      expect(label.match.global).toBe(false)
    }
  })
})

describe('flameDataUri()', () => {
  it('produces a decodable SVG data URI', () => {
    const uri = flameDataUri()
    expect(uri).toMatch(/^data:image\/svg\+xml,/)
    const svg = decodeURIComponent(uri.slice(uri.indexOf(',') + 1))
    expect(svg).toContain('<svg')
    expect(svg).toContain('<linearGradient')
    expect(svg).not.toContain('NaN')
  })

  it('honours a custom branding override', () => {
    const uri = flameDataUri({
      logo: { gradient: ['#111111', '#222222'], path: 'M0 0h24v24H0z' },
    })
    const svg = decodeURIComponent(uri.slice(uri.indexOf(',') + 1))
    expect(svg).toContain('stop-color="#111111"')
    expect(svg).toContain('M0 0h24v24H0z')
  })

  it('never emits NaN offsets for degenerate gradients (regression)', () => {
    const single = flameDataUri({ logo: { gradient: ['#fff'], path: 'M0 0' } })
    expect(single).not.toContain('NaN')
    expect(decodeURIComponent(single.slice(single.indexOf(',') + 1))).toContain(
      'offset="0.000" stop-color="#fff"'
    )

    const empty = flameDataUri({ logo: { gradient: [], path: 'M0 0' } })
    expect(empty).not.toContain('NaN')
  })
})

describe('logoDataUri()', () => {
  it('returns the baked asset as an image data URI', () => {
    const uri = logoDataUri()
    expect(uri).toMatch(/^data:image\//)
    expect(uri.length).toBeGreaterThan(1000)
  })
})
