/**
 * Blazefire client runtime (H-05 rewrite).
 *
 * v1 injected a document-wide MutationObserver ({childList, subtree}) into
 * EVERY client build — production included — whose callback ran
 * querySelectorAll() on every DOM mutation for the life of the page, plus
 * one permanent observer per themed shadow root, with an `observed[]` list
 * that never shrank (spec H-05).
 *
 * v2 contract:
 *  - PRODUCTION: strictly ONE-SHOT. Styles are injected once at module
 *    init; zero MutationObservers are ever constructed. The overlay half is
 *    dev-only, so production bundles pay nothing (the observer code paths
 *    are behind a build-time-inlined NODE_ENV check and are eliminated by
 *    define-inlining).
 *  - DEV: portal discovery and shadow-root observers exist only while their
 *    overlay portal is mounted, then disconnect on portal removal. Every
 *    observer callback is debounced (~100ms trailing), so a burst of DOM
 *    mutations coalesces into a single re-scan instead of one per mutation.
 *
 * SSR-safe: bails immediately when no document exists. Toggles travel as
 * static process.env.NEXT_PUBLIC_* member expressions so the bundler
 * inlines them (a dynamic read survives into the browser as a no-op lookup
 * — the v1 bug that made the toggles silently unswitchable).
 */

import {
  BLAZEFIRE_BRANDING,
  blazefireOverlayStyles,
  blazefireStyles,
} from '../branding.js'

const THEME_ENABLED = process.env.NEXT_PUBLIC_BLAZEFIRE_THEME !== 'false'
const OVERLAY_ENABLED = process.env.NEXT_PUBLIC_BLAZEFIRE_OVERLAY !== 'false'
const IS_PRODUCTION = process.env.NODE_ENV === 'production'

export interface OverlayRuntime {
  /** Release every observer. Idempotent. */
  dispose(): void
  /** Dev diagnostics: count of live observers. */
  observerCount(): number
}

/**
 * Install the theme. One-shot, allocation-light, idempotent.
 * Returns the injected style element (null when already present).
 */
export function injectStyles(doc: Document = document): HTMLStyleElement | null {
  if (doc.getElementById('blazefire-styles')) return null

  const style = doc.createElement('style')
  style.id = 'blazefire-styles'
  style.setAttribute('data-blazefire', BLAZEFIRE_BRANDING.version)
  applyCspNonce(style, doc)
  style.textContent = blazefireStyles()

  if (doc.head) {
    doc.head.appendChild(style)
    return style
  }
  // document.head can be missing very early; retry on DOM ready.
  doc.addEventListener('DOMContentLoaded', () => {
    if (!doc.getElementById('blazefire-styles') && doc.head) {
      doc.head.appendChild(style)
    }
  })
  return style
}

/**
 * Apply the overlay theme + label rewrites inside ONE shadow root.
 * Fully idempotent: every write is conditional, so a settled pass performs
 * zero DOM writes (and therefore triggers no further mutations).
 */
export function applyOverlayToRoot(root: ShadowRoot, doc: Document = document): boolean {
  let changed = false
  if (!root.getElementById('blazefire-overlay-styles')) {
    const style = doc.createElement('style')
    style.id = 'blazefire-overlay-styles'
    style.setAttribute('data-blazefire', 'overlay')
    applyCspNonce(style, doc)
    style.textContent = blazefireOverlayStyles()
    root.appendChild(style)
    changed = true
  }

  for (const label of BLAZEFIRE_BRANDING.labels) {
    let els: NodeListOf<Element>
    try {
      els = root.querySelectorAll(label.selector)
    } catch {
      continue // a selector the host renamed must never break the runtime
    }

    for (const el of els) {
      if (label.attribute) {
        const cur = el.getAttribute(label.attribute)
        if (cur !== null && label.match.test(cur)) {
          changed =
            setAttr(el, label.attribute, cur.replace(label.match, label.replace)) || changed
        }
      } else {
        const text = textChild(el)
        if (text && label.match.test(text.data)) {
          const next = text.data.replace(label.match, label.replace)
          if (next !== text.data) {
            text.data = next
            changed = true
          }
        }
      }
      if (label.title) changed = setAttr(el, 'title', label.title) || changed
    }
  }
  return changed
}

/**
 * Install the overlay rebrand.
 *
 * @param dev pass `!IS_PRODUCTION`; only dev builds may construct observers.
 */
export function installOverlayRuntime(
  dev: boolean,
  doc: Document = document
): OverlayRuntime {
  const observers = new Set<MutationObserver>()
  const rootObservers = new Map<ShadowRoot, MutationObserver>()
  let disposed = false

  // Debounced scheduling (v1 re-ran a full querySelectorAll on EVERY DOM
  // mutation): one trailing timer per observed root plus one for the portal
  // scan, so a burst of mutations coalesces into a single re-scan ~100ms
  // after the burst settles. dispose() cancels whatever is still pending.
  const DEBOUNCE_MS = 100
  const portalToken = {}
  const pending = new Map<object, ReturnType<typeof setTimeout>>()

  const schedule = (token: object, run: () => void): void => {
    if (disposed) return
    const existing = pending.get(token)
    if (existing !== undefined) clearTimeout(existing)
    pending.set(
      token,
      setTimeout(() => {
        pending.delete(token)
        if (!disposed) run()
      }, DEBOUNCE_MS)
    )
  }

  const rebrand = (root: ShadowRoot): void => {
    if (disposed) return
    applyOverlayToRoot(root, doc)
  }

  const scanPortals = (): void => {
    if (disposed) return
    const activeRoots = new Set<ShadowRoot>()
    for (const portal of doc.querySelectorAll('nextjs-portal, blazefire-portal')) {
      if (portal.shadowRoot) {
        activeRoots.add(portal.shadowRoot)
        rebrandPortal(portal.shadowRoot)
      }
    }
    for (const [root, observer] of rootObservers) {
      if (!activeRoots.has(root)) {
        observer.disconnect()
        observers.delete(observer)
        rootObservers.delete(root)
      }
    }
  }

  const rebrandPortal = (root: ShadowRoot): void => {
    rebrand(root)
    if (!dev || disposed || typeof MutationObserver === 'undefined') {
      return // Production: one-shot, no observer.
    }

    // Overlay contents can be mounted or replaced long after the portal's
    // first render; keep this dev-only observer until its portal is removed.
    // Callbacks are debounced: a busy overlay must not re-scan per mutation.
    if (rootObservers.has(root)) return
    const observer = new MutationObserver(() => {
      // Writes inside applyOverlayToRoot stay conditional, so this observer
      // can never trigger a mutation loop of its own.
      schedule(root, () => applyOverlayToRoot(root, doc))
    })
    observer.observe(root, { childList: true, subtree: true, characterData: true })
    observers.add(observer)
    rootObservers.set(root, observer)
  }

  scanPortals()

  // DEV only: watch for the overlay portal being (re)mounted. Scoped to
  // childList on documentElement — never a characterData-heavy scan, and
  // compiled out of production bundles entirely.
  let portalObserver: MutationObserver | undefined
  if (dev && !disposed && typeof MutationObserver !== 'undefined') {
    portalObserver = new MutationObserver(() => schedule(portalToken, scanPortals))
    portalObserver.observe(doc.documentElement, { childList: true, subtree: true })
    observers.add(portalObserver)
  }

  return {
    dispose() {
      if (disposed) return
      disposed = true
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
      for (const observer of observers) observer.disconnect()
      observers.clear()
      rootObservers.clear()
    },
    observerCount() {
      return observers.size
    },
  }
}

/** Install both halves. Returns the overlay handle (disposable) or null. */
export function installBlazefireRuntime(doc?: Document): OverlayRuntime | null {
  if (typeof document === 'undefined' && doc === undefined) return null // SSR-safe
  const d = doc ?? document!

  if (THEME_ENABLED) injectStyles(d)
  if (OVERLAY_ENABLED) return installOverlayRuntime(!IS_PRODUCTION, d)
  return null
}

// Entry side-effect: this module is prepended to the client bootstrap by the
// Turbopack loader (see runtime/turbopack-loader.ts), so installing here is
// what runs before any application code.
if (typeof document !== 'undefined') {
  installBlazefireRuntime()
}

// --- micro-DOM helpers ------------------------------------------------------

/**
 * Copy a CSP nonce onto an injected <style> so it survives a nonce-based
 * Content-Security-Policy. Reads the nonce from an existing [nonce] element
 * (the IDL `.nonce` still holds it even though the content attribute is
 * hidden). Best-effort; a missing/odd document just skips the nonce.
 */
function applyCspNonce(style: HTMLStyleElement, doc: Document): void {
  try {
    const el = doc.querySelector('[nonce]') as
      | (Element & { nonce?: string })
      | null
    const nonce = el?.nonce || el?.getAttribute('nonce') || undefined
    if (nonce) style.nonce = nonce
  } catch {
    // no querySelector / no nonce present — nothing to copy
  }
}

function textChild(el: Element): Text | null {
  let node = el.firstChild
  while (node) {
    if (node.nodeType === 3 /* TEXT_NODE */ && (node as Text).data.trim()) {
      return node as Text
    }
    node = node.nextSibling
  }
  return null
}

function setAttr(el: Element, name: string, value: string): boolean {
  if (el.getAttribute(name) === value) return false
  el.setAttribute(name, value)
  return true
}
