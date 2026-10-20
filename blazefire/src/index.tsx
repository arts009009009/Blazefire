/**
 * Blazefire TypeScript Entry Point
 *
 * Types for the runtime entry point (`blazefire/index.js`), which re-exports
 * `utils.js` (server-safe helpers) and `provider.js` (`'use client'` React
 * context). Both halves are declared here so the one `types` entry describes
 * the whole `blazefire` module. Keep this file in sync with both.
 */

import React, { createContext, useContext, useEffect } from 'react'

export interface BlazefireConfig {
  theme?: 'dark' | 'light'
  primaryColor?: string
  enableGlow?: boolean
}

export interface CompilerOptions {
  jsc?: {
    parser?: { syntax: string; tsx?: boolean }
    transform?: { react?: { runtime: string } }
  }
  module?: { type: string }
}

export interface CompilerInstance {
  options: CompilerOptions
  version: string
  transform(code: string, filename?: string): Promise<{ code: string }>
}

// NOTE: must match `version` in the package manifest (kept in sync with the
// runtime constants in `blazefire/utils.js`; asserted by
// __tests__/version-sync.test.js).
export const BLAZEFIRE_VERSION = '1.1.2'
export const FROSTFAST_VERSION = '1.0.0'

// Self-contained inline SVG flame mark — no external PNG asset.
// See blazefire/index.js for why the previous `new URL(..., import.meta.url)`
// approach broke (asset not shipped + import.meta.url rewritten in the browser).
const BLAZEFIRE_LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none">' +
  '<defs><linearGradient id="bf-flame" x1="20" y1="5" x2="20" y2="35" gradientUnits="userSpaceOnUse">' +
  '<stop stop-color="#ff8800"/><stop offset="0.4" stop-color="#ff4400"/>' +
  '<stop offset="0.7" stop-color="#ff006e"/><stop offset="1" stop-color="#cc00cc"/>' +
  '</linearGradient></defs>' +
  '<path d="M20 3C20 3 30 14 30 23C30 28 25.5 32 20 32C14.5 32 10 28 10 23C10 14 20 3 20 3Z" fill="url(#bf-flame)"/>' +
  '<path d="M20 11C20 11 25 18 25 23C25 25.8 22.8 28 20 28C17.2 28 15 25.8 15 23C15 18 20 11 20 11Z" fill="url(#bf-flame)" opacity="0.6"/>' +
  '<path d="M20 16C20 16 22.5 20 22.5 23C22.5 24.4 21.4 25.5 20 25.5C18.6 25.5 17.5 24.4 17.5 23C17.5 20 20 16 20 16Z" fill="#ffcc00" opacity="0.8"/>' +
  '</svg>'
const BLAZEFIRE_LOGO_URL =
  'data:image/svg+xml,' + encodeURIComponent(BLAZEFIRE_LOGO_SVG)

export function insertBlazefireStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById('blazefire-styles')) return

  const style = document.createElement('style')
  style.id = 'blazefire-styles'
  style.textContent = getBlazefireCSS()

  // `document.head` can be missing when this runs extremely early; retry on
  // DOM ready rather than throwing a TypeError out of a user's component.
  if (document.head) {
    document.head.appendChild(style)
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      if (!document.getElementById('blazefire-styles') && document.head) {
        document.head.appendChild(style)
      }
    })
  }
}

/** Mirrors `getBlazefireCSS()` in the runtime entry (`blazefire/index.js`). */
function getBlazefireCSS(): string {
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

export function createBlazefireLogo(size?: number): string {
  // The size is interpolated into an attribute list, so it must be a number —
  // an unvalidated string like `40" onerror="…` would close the attribute and
  // inject markup. Anything non-numeric falls back to the default.
  let n: number
  try {
    n = Number(size)
  } catch {
    n = NaN
  }
  const safe = Number.isFinite(n) && n > 0 ? n : 40
  return `<img src="${BLAZEFIRE_LOGO_URL}" width="${safe}" height="${safe}" alt="Blazefire" style="object-fit:contain" draggable="false">`
}

export function createCompiler(
  options: CompilerOptions = {}
): CompilerInstance {
  const defaultJsc = {
    parser: { syntax: 'typescript', tsx: true },
    transform: { react: { runtime: 'automatic' } },
  }
  const defaultModule = { type: 'es6' }

  // Merge one level deep: passing `{ jsc: { parser: … } }` must not silently
  // drop `jsc.transform.react` (and with it the automatic JSX runtime) — and
  // equally, keys we do not know about must survive rather than be deleted.
  const jsc = options.jsc || {}
  const mod: { type?: string } = options.module || {}
  const merged: CompilerOptions = {
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
    async transform(code: string, _filename?: string) {
      return { code }
    },
  }
}

interface BlazefireContextValue {
  version: string
  compiler: string
  runtime: string
}

const BlazefireContext = createContext<BlazefireContextValue>({
  version: BLAZEFIRE_VERSION,
  compiler: 'frostfast',
  runtime: 'blazefire',
})

export function useBlazefire(): BlazefireContextValue {
  return useContext(BlazefireContext)
}

export interface BlazefireProviderProps {
  children: React.ReactNode
}

// `process.env.NODE_ENV` is defined by the bundler on both server and client.
// Declared locally (module-scoped, shadowing any global) so this types entry
// compiles without @types/node while keeping the exact literal form the
// bundler statically replaces — see provider.js for the runtime original.
declare const process: { env: { NODE_ENV?: string } } | undefined

/** Mirrors `BlazefireDevToolsAuto` in the runtime provider (`blazefire/provider.js`). */
function BlazefireDevToolsAuto() {
  const isDev =
    typeof process !== 'undefined' &&
    process.env &&
    process.env.NODE_ENV === 'development'
  if (!isDev) return null
  return React.createElement('div', {
    'data-blazefire-devtools': true,
    role: 'status',
    style: { position: 'fixed', bottom: 20, right: 20, zIndex: 2147483647 },
    'aria-label': 'Blazefire Dev Tools',
  })
}

export function BlazefireProvider({ children }: BlazefireProviderProps) {
  useEffect(() => {
    insertBlazefireStyles()
  }, [])

  return (
    <BlazefireContext.Provider
      value={{
        version: BLAZEFIRE_VERSION,
        compiler: 'frostfast',
        runtime: 'blazefire',
      }}
    >
      {children}
      <BlazefireDevToolsAuto />
    </BlazefireContext.Provider>
  )
}

const Blazefire = {
  version: BLAZEFIRE_VERSION,
  createCompiler,
  insertBlazefireStyles,
  createBlazefireLogo,
  BlazefireProvider,
  useBlazefire,
}

export default Blazefire
