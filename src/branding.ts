/**
 * Blazefire branding — SINGLE SOURCE OF TRUTH (spec H-18 dedupe).
 *
 * v1 shipped three copies of the theme (assets/*.css, generated CSS strings
 * in branding.cjs, and an inline string in utils.js) plus two copies of the
 * logo (PNG + baked base64). v2 has exactly one of each:
 *
 *   - colours/tokens/labels: this file
 *   - the emblem: /blazefire-logo.png (the data-URI form is generated at
 *     build time into src/generated/logo-data.ts, never hand-mirrored)
 */

import { LOGO_DATA_URI } from './generated/logo-data.js'
import { BLAZEFIRE_VERSION, FROSTFAST_VERSION } from './version.js'

/** A text/attribute rewrite rule applied to the dev overlay's shadow DOM. */
export interface BrandLabel {
  selector: string
  match: RegExp
  replace: string
  /** When set, rewrite this attribute instead of the element's text node. */
  attribute?: string
  title?: string
}

export interface Branding {
  name: string
  compiler: string
  version: string
  compilerVersion: string
  headers: { poweredBy: string; compiler: string }
  banner: string
  labels: BrandLabel[]
  logo: {
    selectors: string[]
    /** SVG-flame fallback geometry (used only if the PNG asset is absent). */
    path: string
    gradient: string[]
    sizes: Record<string, string>
  }
  colors: {
    cyan: string
    magenta: string
    red: string
    green: string
    orange: string
    background: string
    surface: string
    text: string
  }
  topBarGradient: string
}

export const BLAZEFIRE_BRANDING: Branding = {
  name: 'Blazefire',
  compiler: 'Frostfast',
  version: BLAZEFIRE_VERSION,
  compilerVersion: FROSTFAST_VERSION,

  headers: {
    poweredBy: 'Blazefire Framework',
    compiler: `Frostfast v${FROSTFAST_VERSION}`,
  },

  banner: `Blazefire Runtime v${BLAZEFIRE_VERSION} | Frostfast Compiler v${FROSTFAST_VERSION}`,

  // Literal TEXT NODES inside the dev overlay's shadow root — no stylesheet
  // can change them, so the dev-only runtime rewrites them in the DOM.
  // `match` is always the host framework's own pattern; never /g/ (a global
  // regex is stateful under .test() and would skip every other element).
  labels: [
    {
      selector: '[data-nextjs-version-checker]',
      match: /^Next\.js\s+[\w.\-+]+/,
      replace: `Blazefire ${BLAZEFIRE_VERSION}`,
      title: `Blazefire ${BLAZEFIRE_VERSION}`,
    },
    {
      selector: '.turbopack-text',
      match: /^Turbopack$/,
      replace: 'Frostfast',
    },
    {
      selector: 'button[aria-label*="Dev Tools"]',
      match: /Next\.js/,
      replace: 'Blazefire',
      attribute: 'aria-label',
      title: 'Open Blazefire Dev Tools',
    },
  ],

  logo: {
    // Only these two carry the host framework's mark; pagination/copy/close
    // icons are not its identity and stay as-is.
    selectors: ['#next-logo > svg', '.code-frame-icon > svg'],
    path: 'M12 1.5c1.9 3.9.7 6.2-1.1 8-2 2-3.4 3.9-3.4 6.7a4.5 4.5 0 0 0 9 0c0-2.2-1.1-3.9-2.5-5.4.3 2.3-.6 3.4-1.8 3.9.9-2.7-.4-5.2-2.5-7C9 6 11.6 4.2 12 1.5z',
    gradient: ['#ff8800', '#ff006e', '#00ffff', '#ff00ff'],
    sizes: { '#next-logo > svg': '62%', '.code-frame-icon > svg': '92%' },
  },

  colors: {
    cyan: '#00ffff',
    magenta: '#ff00ff',
    red: '#ff006e',
    green: '#00ff41',
    orange: '#ff8800',
    background: '#000000',
    surface: '#050505',
    text: '#e0e0e0',
  },

  topBarGradient: 'linear-gradient(90deg, #ff8800, #ff006e, #00ffff, #ff00ff)',
}

/** The global document theme. */
export function blazefireStyles(branding: Branding = BLAZEFIRE_BRANDING): string {
  const c = branding.colors
  return `
:root {
  --blazefire-cyan: ${c.cyan};
  --blazefire-magenta: ${c.magenta};
  --blazefire-red: ${c.red};
  --blazefire-green: ${c.green};
  --blazefire-orange: ${c.orange};
  --blazefire-background: ${c.background};
  --blazefire-surface: ${c.surface};
  --blazefire-text: ${c.text};
  --glow-cyan: 0 0 10px rgba(0, 255, 255, 0.3), 0 0 20px rgba(0, 255, 255, 0.1);
  --glow-magenta: 0 0 10px rgba(255, 0, 255, 0.3), 0 0 20px rgba(255, 0, 255, 0.1);
}
body::before {
  content: "";
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: ${branding.topBarGradient};
  z-index: 2147483647;
  pointer-events: none;
}
@keyframes blazefire-glow {
  0%, 100% { box-shadow: 0 0 5px rgba(0, 255, 255, 0.3); }
  50% { box-shadow: 0 0 15px rgba(0, 255, 255, 0.6), 0 0 30px rgba(255, 0, 255, 0.3); }
}
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: ${c.background}; }
::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, ${c.cyan}, ${c.magenta});
  border-radius: 3px;
}
html { color-scheme: dark; }
`.trim()
}

/**
 * SVG/React `<stop>` offset for index `i` of a gradient with `count` stops.
 *
 * A single stop has no neighbour to interpolate against; without the guard
 * `i / (count - 1)` yields Infinity (React) or NaN (string) — the SVG path
 * always guarded this, the React logo component did not (L-30). Shared here
 * so both surfaces compute offsets from the SAME rule.
 */
export function gradientStopOffset(i: number, count: number): number {
  const span = count - 1
  return span > 0 ? i / span : 0
}

/**
 * Self-contained SVG flame — the fallback mark when the PNG asset is absent.
 * The gradient stays in sync with `logo.gradient` by construction.
 */
export function flameDataUri(branding: Branding = BLAZEFIRE_BRANDING): string {
  const g = branding.logo.gradient
  const stops = g
    .map(
      (colour, i) =>
        `<stop offset="${gradientStopOffset(i, g.length).toFixed(3)}" stop-color="${colour}"/>`
    )
    .join('')

  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
    '<defs><linearGradient id="f" x1="0" y1="1" x2="1" y2="0">' +
    stops +
    '</linearGradient></defs>' +
    '<path d="' +
    branding.logo.path +
    '" fill="url(#f)"/></svg>'

  return 'data:image/svg+xml,' + encodeURIComponent(svg)
}

/**
 * The emblem actually painted over the host framework's mark: the canonical
 * PNG (generated into a data URI at build time), falling back to the SVG
 * flame. A data URI — not a file path — because the stylesheet is injected
 * into a shadow root at runtime, where a relative URL would resolve against
 * the page, not this package.
 */
export function logoDataUri(branding: Branding = BLAZEFIRE_BRANDING): string {
  if (/^data:image\//.test(LOGO_DATA_URI)) return LOGO_DATA_URI
  return flameDataUri(branding)
}

/**
 * The dev-overlay theme, injected INTO the overlay's shadow root (document
 * CSS cannot reach a shadow tree). Tokens are declared on every :host form of
 * equal-or-higher specificity so the override wins regardless of the host's
 * class or the OS colour scheme.
 */
export function blazefireOverlayStyles(branding: Branding = BLAZEFIRE_BRANDING): string {
  const c = branding.colors

  const selectors = `:host,
:host(.dark),
:host(.light),
:host(:not(.light)),
:host(:not(.dark))`

  const tokens = `
  --color-font: ${c.text};
  --color-title-color: ${c.magenta};
  --color-accents-1: ${c.cyan};
  --color-accents-2: ${c.surface};
  --color-accents-3: #1a1a1a;
  --color-backdrop: rgba(0, 0, 0, 0.92);
  --color-border-shadow: rgba(0, 255, 255, 0.32);
  --focus-color: ${c.cyan};
  --focus-ring: 0 0 0 2px rgba(0, 255, 255, 0.35);
  --shadow-md: 0 0 12px rgba(0, 255, 255, 0.18);
  --shadow-lg: 0 0 24px rgba(255, 0, 255, 0.16);
`

  // The host mark's <svg> box is kept (React reconciles against it); its
  // children are hidden and the emblem painted as the box's background.
  const logo = logoDataUri(branding)
  const logos = branding.logo.selectors
    .map((sel) => {
      const size = branding.logo.sizes[sel] ?? 'contain'
      return `${sel} > * { visibility: hidden; }
${sel} {
  background-image: url("${logo}");
  background-size: ${size};
  background-repeat: no-repeat;
  background-position: center;
}`
    })
    .join('\n')

  return `
${selectors} {${tokens}}
#next-logo { justify-content: center; }
.nextjs-container {
  border-top: 2px solid transparent;
  background-image:
    linear-gradient(${c.surface}, ${c.surface}),
    ${branding.topBarGradient};
  background-origin: border-box;
  background-clip: padding-box, border-box;
}
.nextjs-toast [data-next-badge][data-error='false'],
.nextjs-toast [data-next-badge][data-error='false']:hover {
  background-color: transparent;
  box-shadow: none;
}
${logos}
[data-next-badge]:not([data-error='true']) {
  background: transparent;
  box-shadow: none;
}
`.trim()
}
