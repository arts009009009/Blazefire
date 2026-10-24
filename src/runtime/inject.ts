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
 *  - DEV: observers exist only while the overlay can still appear, and each
 *    shadow-root observer SETTLES (disconnects after N consecutive no-op
 *    passes) instead of watching forever.
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

/** Dev-only: how many consecutive no-op passes settle a shadow-root observer. */
const SETTLE_AFTER_PASSES = 3

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
  const observers: MutationObserver[] = []
  let disposed = false

  const rebrand = (root: ShadowRoot): void => {
    if (disposed) return
    applyOverlayToRoot(root, doc)
  }

  const scanPortals = (): void => {
    if (disposed) return
    for (const portal of doc.querySelectorAll('nextjs-portal, blazefire-portal')) {
      if (portal.shadowRoot) rebrandPortal(portal.shadowRoot)
    }
  }

  const rebrandPortal = (root: ShadowRoot): void => {
    rebrand(root)
    if (!dev || disposed || typeof MutationObserver === 'undefined') {
      return // PRODUCTION: one-shot, no observer, ever.
    }

    // Mutations inside a shadow root never reach document observers, so each
    // themed root gets its own — which then SETTLES instead of watching
    // forever (the v1 leak).
    if ((root as unknown as { __blazefireObserved?: boolean }).__blazefireObserved) return
    ;(root as unknown as { __blazefireObserved?: boolean }).__blazefireObserved = true

    let cleanPasses = 0
    const observer = new MutationObserver(() => {
      if (disposed) return
      // applyOverlayToRoot only writes when something differs; a pass with
      // no writes means the overlay has settled.
      const changed = applyOverlayToRoot(root, doc)
      cleanPasses = changed ? 0 : cleanPasses + 1
      if (cleanPasses >= SETTLE_AFTER_PASSES) {
        observer.disconnect()
        observers.splice(observers.indexOf(observer), 1)
      }
    })
    observer.observe(root, { childList: true, subtree: true, characterData: true })
    observers.push(observer)
  }

  scanPortals()

  // DEV only: watch for the overlay portal being (re)mounted. Scoped to
  // childList on documentElement — never a characterData-heavy scan, and
  // compiled out of production bundles entirely.
  let portalObserver: MutationObserver | undefined
  if (dev && !disposed && typeof MutationObserver !== 'undefined') {
    portalObserver = new MutationObserver(() => scanPortals())
    portalObserver.observe(doc.documentElement, { childList: true, subtree: true })
    observers.push(portalObserver)
  }

  return {
    dispose() {
      if (disposed) return
      disposed = true
      portalObserver?.disconnect()
      for (const o of observers) o.disconnect()
      observers.length = 0
    },
    observerCount() {
      return observers.length
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
