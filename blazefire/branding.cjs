/**
 * Blazefire branding — SINGLE SOURCE OF TRUTH
 *
 * Every string, colour, and asset used to brand a project lives here.
 * The plugin, the runtime injector, and the components all read from this
 * object, so rebranding is a one-file change.
 */

'use strict'

// The emblem, baked in as a data URI (see build-logo-data.cjs). Required in
// a try/catch because this module also runs inside the client bundle, where
// a missing generated file must degrade to the SVG flame, not break the
// build's runtime. Deliberately NOT read from disk at runtime: `fs` does not
// exist in the browser bundle, so a synchronous read here would throw at
// import time.
let LOGO_ASSET_DATA_URI = ''
try {
  LOGO_ASSET_DATA_URI = require('./logo-data.cjs')
} catch (e) {
  // no baked asset — flameDataUri() fallback is used instead
}

const BLAZEFIRE_BRANDING = {
  name: 'Blazefire',
  compiler: 'Frostfast',
  version: '1.0.0',
  compilerVersion: '1.0.0',

  // Response headers
  headers: {
    poweredBy: 'Blazefire Framework',
    compiler: 'Frostfast v1.0.0',
  },

  // Startup banner shown by `next dev` / `next start`
  banner: 'Blazefire Runtime v1.0.0 | Frostfast Compiler v1.0.0',

  // Dev-overlay text identities.
  //
  // These are literal TEXT NODES and an aria-label inside Next's shadow-root
  // overlay, so no stylesheet can change them — CSS only recolours. The
  // runtime rewrites them in the DOM instead (see runtime/inject.cjs).
  //
  // `match`/`replace` feed String.replace, so `match` is always Next's own
  // pattern (that is how we recognise its node) while `replace` is ours.
  // Matches must NOT be /g/: .test() on a global regex is stateful and would
  // skip every other element.
  labels: [
    // "Next.js 16.3.8" / "Next.js 16.4.0-canary.4 (stale)" -> "Blazefire 1.0.0…"
    //
    // The version is matched separately from the surrounding text so that
    // canary's "(stale)" / "(latest)" suffixes survive the rewrite instead of
    // being wiped out. `[\w.\-+]` covers full semver plus prerelease tags.
    {
      selector: '[data-nextjs-version-checker]',
      match: /^Next\.js\s+[\w.\-+]+/,
      replace: 'Blazefire 1.0.0',
      title: 'Blazefire 1.0.0',
    },
    // "Turbopack" pill -> "Frostfast"
    {
      selector: '.turbopack-text',
      match: /^Turbopack$/,
      replace: 'Frostfast',
    },
    // Dev-tools launcher button. The mark inside it is handled by `logo`
    // below. Matching on "Dev Tools" rather than "Next.js Dev Tools" keeps
    // the node selected after we ourselves have rewritten its label.
    {
      selector: 'button[aria-label*="Dev Tools"]',
      match: /Next\.js/,
      replace: 'Blazefire',
      attribute: 'aria-label',
      title: 'Open Blazefire Dev Tools',
    },
  ],

  // The Blazefire emblem, drawn over Next's "N" glyph.
  //
  // Done in pure CSS (see blazefireOverlayStyles): Next's SVG children are
  // merely hidden and the logo painted as that same <svg>'s background. The
  // element itself is never removed or re-parented, so React's
  // reconciliation — which would throw if we deleted nodes it owns — is
  // never disturbed.
  logo: {
    // Only these two carry Next's mark. The pagination/copy/close icons and
    // the Node.js inspector glyph are not Next's identity and stay as-is.
    selectors: ['#next-logo > svg', '.code-frame-icon > svg'],
    // The custom emblem (assets/blazefire-logo.png), baked into
    // logo-data.cjs by build-logo-data.cjs so the client bundle needs no
    // fs access. When that module is absent, logoDataUri() falls back to
    // the self-contained SVG flame below.
    asset: 'assets/blazefire-logo.png',
    // SVG-flame fallback path/gradient (only used when the asset is absent).
    path: 'M12 1.5c1.9 3.9.7 6.2-1.1 8-2 2-3.4 3.9-3.4 6.7a4.5 4.5 0 0 0 9 0c0-2.2-1.1-3.9-2.5-5.4.3 2.3-.6 3.4-1.8 3.9.9-2.7-.4-5.2-2.5-7C9 6 11.6 4.2 12 1.5z',
    gradient: ['#ff8800', '#ff006e', '#00ffff', '#ff00ff'],
    // Background sizing, per host element (the two glyphs sit in very
    // differently sized boxes).
    sizes: { '#next-logo > svg': '62%', '.code-frame-icon > svg': '92%' },
  },

  // Palette — OLED-first cyberpunk
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

  // Gradient that runs across the top of every page
  topBarGradient: 'linear-gradient(90deg, #ff8800, #ff006e, #00ffff, #ff00ff)',
}

/**
 * Generates the global stylesheet. Kept as a function so it can be inlined
 * into a <style> tag, emitted as a .css file, or injected at runtime.
 *
 * @param {typeof BLAZEFIRE_BRANDING} [branding]
 * @returns {string}
 */
function blazefireStyles(branding = BLAZEFIRE_BRANDING) {
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
@keyframes blazefire-pulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
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
 * The SVG flame fallback, used when the baked PNG asset (logo-data.cjs) is
 * absent — e.g. a GitHub tarball installed without running `npm run build:logo`.
 *
 * Built here so the gradient stays in sync with `logo.gradient` and the mark
 * can be referenced from a stylesheet without shipping an asset.
 *
 * @param {typeof BLAZEFIRE_BRANDING} [branding]
 * @returns {string}
 */
function flameDataUri(branding = BLAZEFIRE_BRANDING) {
  const g = branding.logo.gradient
  const stops = g
    .map(
      (colour, i) =>
        `<stop offset="${(i / (g.length - 1)).toFixed(3)}" stop-color="${colour}"/>`
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
 * The image actually painted over Next's mark: the custom Blazefire emblem
 * (a `data:image/png` baked into logo-data.cjs) when present, otherwise the
 * SVG flame above.
 *
 * A data URI — not a file path — because the stylesheet is injected into
 * Next's shadow root at runtime, where a relative asset URL would resolve
 * against the page, not this package.
 *
 * @param {typeof BLAZEFIRE_BRANDING} [branding]
 * @returns {string}
 */
function logoDataUri(branding = BLAZEFIRE_BRANDING) {
  if (
    typeof LOGO_ASSET_DATA_URI === 'string' &&
    /^data:image\//.test(LOGO_ASSET_DATA_URI)
  ) {
    return LOGO_ASSET_DATA_URI
  }
  return flameDataUri(branding)
}

/**
 * Generates the overlay (dev tools) theme.
 *
 * Next.js renders the dev overlay inside a shadow root, so document-level CSS
 * cannot reach it. The overlay is instead themed entirely through CSS custom
 * properties declared on `:host` — so overriding those tokens from a <style>
 * injected INTO the shadow root rebrands it without touching next's code.
 *
 * @param {typeof BLAZEFIRE_BRANDING} [branding]
 * @returns {string}
 */
function blazefireOverlayStyles(branding = BLAZEFIRE_BRANDING) {
  const c = branding.colors

  // Next declares its tokens under several selectors of DIFFERENT
  // specificity, and the highest one wins regardless of source order:
  //   :host                     -> 0,1,0
  //   :host(.dark)/(.light)     -> 0,2,0   (only matches if host has a class)
  //   :host(:not(.light))       -> 0,2,0   <-- THE ONE THAT WINS: the portal
  //                                            usually has NO class, so this
  //                                            always matches, and inside a
  //                                            prefers-color-scheme media
  //                                            query it beats plain :host
  //                                            no matter where we insert.
  // We therefore declare on the :not() forms too (which match whether or not
  // the host carries a class), unconditionally so we don't depend on the OS
  // color scheme.
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

  // Next's "N" mark: hide what Next drew inside the <svg> (the box itself is
  // untouched, so React keeps a valid element to reconcile against) and paint
  // the Blazefire emblem as the <svg>'s own background instead.
  const logo = logoDataUri(branding)
  const logos = branding.logo.selectors
    .map((sel) => {
      const size =
        (branding.logo.sizes && branding.logo.sizes[sel]) || 'contain'
      return `${sel} > * { visibility: hidden; }
${sel} {
  background-image: url("${logo}");
  background-size: ${size};
  background-repeat: no-repeat;
  background-position: center;
}`
    })
    .join('\n')

  // The launcher's <svg> is 40x40 inside a 32x32 button, and the button is a
  // flex row with Next's default `justify-content: start` — so the <svg>
  // overflows 8px past its RIGHT edge and is only vertically centred. The
  // emblem is centred on the <svg>, which puts it 4px right of the button's
  // centre and makes it spill out of the button's circular background.
  // Centring the <svg> horizontally lands its paint box exactly on the button.
  const markHost = `#next-logo {
  justify-content: center;
}`

  return `
${selectors} {${tokens}}
${markHost}
/* Blazefire gradient rail across the top of the error-overlay container.
   The indicator pill (.nextjs-toast) deliberately gets NO rail and no fill
   — nothing is drawn above or around the emblem. */
.nextjs-container {
  border-top: 2px solid transparent;
  background-image:
    linear-gradient(${c.surface}, ${c.surface}),
    ${branding.topBarGradient};
  background-origin: border-box;
  background-clip: padding-box, border-box;
}
/* Idle badge disc behind the emblem: drop Next's black fill, ring and drop
   shadow so the logo floats on the page. Scoped to data-error="false" so
   the red "N Issues" pill keeps its own background. */
.nextjs-toast [data-next-badge][data-error='false'],
.nextjs-toast [data-next-badge][data-error='false']:hover {
  background-color: transparent;
  box-shadow: none;
}
/* Next's "N" glyph -> Blazefire emblem */
${logos}
/* Drop the dark badge plate (rgba(0,0,0,.8) + ring shadow) that Next draws
   behind the mark, so the transparent-cornered emblem sits directly on the
   page with no rectangle around it. The error state keeps its red plate. */
[data-next-badge]:not([data-error='true']) {
  background: transparent;
  box-shadow: none;
}
`.trim()
}

module.exports = {
  BLAZEFIRE_BRANDING,
  blazefireStyles,
  blazefireOverlayStyles,
  flameDataUri,
  logoDataUri,
}
