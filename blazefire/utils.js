/**
 * Blazefire utilities that are safe to call from anywhere — a React Server
 * Component, a Client Component, or a plain `next build`.
 *
 * Deliberately free of hooks and of the `'use client'` directive. The entry
 * point (`index.js`) re-exports these alongside the client components: if the
 * directive sat on the entry instead, every export would become a client
 * reference and a plain `insertBlazefireStyles()` in a Server Component would
 * throw. Keeping the two sides in separate modules is what lets both work.
 */

// NOTE: this string must match `version` in the package manifest. It cannot
// be read at runtime here — this module also ships inside the browser bundle,
// where a JSON import would be either a bundler dependency or a hard failure
// on older Node — so a test (__tests__/version-sync.test.js) asserts the two
// stay identical and fails the suite when a release bumps one without the
// other.
export const BLAZEFIRE_VERSION = '1.1.2'
export const FROSTFAST_VERSION = '1.0.0'

// Self-contained inline SVG flame mark, used by createBlazefireLogo() below.
var BLAZEFIRE_LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none">' +
  '<defs><linearGradient id="bf-flame" x1="20" y1="5" x2="20" y2="35" gradientUnits="userSpaceOnUse">' +
  '<stop stop-color="#ff8800"/><stop offset="0.4" stop-color="#ff4400"/>' +
  '<stop offset="0.7" stop-color="#ff006e"/><stop offset="1" stop-color="#cc00cc"/>' +
  '</linearGradient></defs>' +
  '<path d="M20 3C20 3 30 14 30 23C30 28 25.5 32 20 32C14.5 32 10 28 10 23C10 14 20 3 20 3Z" fill="url(#bf-flame)"/>' +
  '<path d="M20 11C20 11 25 18 25 23C25 25.8 22.8 28 20 28C17.2 28 15 25.8 15 23C15 18 20 11 20 11Z" fill="url(#bf-flame)" opacity="0.6"/>' +
  '<path d="M20 16C20 16 22.5 20 22.5 23C22.5 24.4 21.4 25.5 20 25.5C18.6 25.5 17.5 24.4 17.5 23C17.5 20 20 16 20 16Z" fill="#ffcc00" opacity="0.8"/>' +
  '</svg>'
var BLAZEFIRE_LOGO_URL =
  'data:image/svg+xml,' + encodeURIComponent(BLAZEFIRE_LOGO_SVG)

/** SSR-safe style injection — a no-op on the server. */
export function insertBlazefireStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById('blazefire-styles')) return

  var style = document.createElement('style')
  style.id = 'blazefire-styles'
  style.textContent = getBlazefireCSS()

  // `document.head` can be missing when this is called extremely early (or in
  // a non-HTML document); retry on DOM ready instead of throwing a TypeError
  // out of a user's component.
  if (document.head) {
    document.head.appendChild(style)
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      if (!document.getElementById('blazefire-styles') && document.head) {
        document.head.appendChild(style)
      }
    })
  }
}

function getBlazefireCSS() {
  return `
    :root {
      --blazefire-cyan: #00ffff;
      --blazefire-magenta: #ff00ff;
      --blazefire-red: #ff006e;
      --blazefire-green: #00ff41;
      --blazefire-orange: #ff8800;
      --blazefire-background: #000000;
      --blazefire-surface: #050505;
      --blazefire-text: #e0e0e0;
      --glow-cyan: 0 0 10px rgba(0,255,255,0.3), 0 0 20px rgba(0,255,255,0.1);
      --glow-magenta: 0 0 10px rgba(255,0,255,0.3), 0 0 20px rgba(255,0,255,0.1);
    }
    body::before {
      content: "";
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 2px;
      background: linear-gradient(90deg, #ff8800, #ff006e, #00ffff, #ff00ff);
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
    ::-webkit-scrollbar-track { background: #000000; }
    ::-webkit-scrollbar-thumb {
      background: linear-gradient(180deg, #00ffff, #ff00ff);
      border-radius: 3px;
    }
    html { color-scheme: dark; }
  `
}

/**
 * The flame mark as a self-contained `<img>` string.
 *
 * The image URL is an inline SVG data URI rather than `new URL('./assets/
 * blazefire-logo.png', import.meta.url)`: that broke when the PNG was not
 * shipped with the package, and `import.meta.url` is rewritten to the bundled
 * chunk URL in the browser so the relative path 404'd anyway. A data URI needs
 * no external asset and works in SSR, the browser, and any bundler.
 */
export function createBlazefireLogo(size) {
  // The size is interpolated into an attribute list, so it must be a number —
  // an unvalidated string like `40" onerror="…` would close the attribute and
  // inject markup. Anything non-numeric falls back to the default.
  var n
  try {
    n = Number(size)
  } catch (_) {
    n = NaN
  }
  if (!Number.isFinite(n) || n <= 0) n = 40
  return (
    '<img src="' +
    BLAZEFIRE_LOGO_URL +
    '" width="' +
    n +
    '" height="' +
    n +
    '" alt="Blazefire" style="object-fit:contain" draggable="false">'
  )
}

/**
 * Frostfast compiler factory.
 *
 * Nested defaults are merged one level deep rather than replaced: passing
 * `{ jsc: { parser: … } }` must not silently drop `jsc.transform.react`.
 */
export function createCompiler(options) {
  options = options || {}
  var defaultJsc = {
    parser: { syntax: 'typescript', tsx: true },
    transform: { react: { runtime: 'automatic' } },
  }
  var defaultModule = { type: 'es6' }

  // Merge one level deep: passing `{ jsc: { parser: … } }` must not silently
  // drop `jsc.transform.react` (and with it the automatic JSX runtime) — and
  // equally, keys we do not know about (`jsc.target`, `module.noInterop`, …)
  // must survive rather than be deleted by the merge.
  var jsc = options.jsc || {}
  var mod = options.module || {}
  var merged = {
    ...options,
    jsc: {
      ...jsc,
      parser: jsc.parser ?? defaultJsc.parser,
      transform: jsc.transform ?? defaultJsc.transform,
    },
    module: { ...mod, type: mod.type ?? defaultModule.type },
  }

  return {
    options: merged,
    version: FROSTFAST_VERSION,
    transform: function (code) {
      return Promise.resolve({ code: code })
    },
  }
}
