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

// One pending DOMContentLoaded retry per document: repeated calls while
// `head` is missing must not stack listeners (pre-fix, every call leaked a
// listener AND an orphan <style> that could never attach).
const styleRetryPending = new WeakSet<Document>()

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
  // document.head can be missing very early — but only WHILE the document is
  // still loading. A listener registered after DOMContentLoaded has fired
  // never fires again (pre-fix: unstyled page, no error), so gate on
  // readyState and attach at most ONE listener per document ({ once: true }
  // + the WeakSet guard): later calls re-check via the idempotency guard
  // above once the style has landed.
  if (doc.readyState === 'loading' && !styleRetryPending.has(doc)) {
    styleRetryPending.add(doc)
    doc.addEventListener(
      'DOMContentLoaded',
      () => {
        styleRetryPending.delete(doc)
        if (!doc.getElementById('blazefire-styles') && doc.head) {
          doc.head.appendChild(style)
        }
      },
      { once: true }
    )
  }
  // readyState past 'loading' with no head: DOMContentLoaded already fired,
  // so there is no event left to retry on. Return the (not-yet-attached)
  // style — a later call after `head` exists will land it.
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
        if (text) {
          // L-11: textChild skips empty nodes but returns the RAW data, while
          // label.match is anchored (^…$) — ' Turbopack ' passed the gate yet
          // failed the regex, so the label never rebranded. Match/replace
          // against the trimmed CORE and re-apply the original lead/trail
          // whitespace so layout is untouched. (Still the documented two-step
          // test→replace on a non-/g/ regex — see branding.ts: lastIndex is
          // only safe because these are never global.)
          const data = text.data
          const core = data.trim()
          if (label.match.test(core)) {
            const nextCore = core.replace(label.match, label.replace)
            if (nextCore !== core) {
              const lead = data.length - data.trimStart().length
              const trail = data.length - data.trimEnd().length
              text.data = data.slice(0, lead) + nextCore + data.slice(data.length - trail)
              changed = true
            }
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
  //
  // Trailing-only debounce starves under SUSTAINED mutation: every mutation
  // resets the timer, so a continuously-mutating overlay postpones its
  // rebrand forever. MAX_WAIT_MS bounds the wait — once a token's FIRST
  // schedule in the current burst is that old, the next reschedule runs at
  // delay 0 instead of resetting fully.
  const DEBOUNCE_MS = 100
  const MAX_WAIT_MS = 500
  const portalToken = {}
  const pending = new Map<object, ReturnType<typeof setTimeout>>()
  const firstScheduled = new Map<object, number>()

  const schedule = (token: object, run: () => void): void => {
    if (disposed) return
    const existing = pending.get(token)
    if (existing !== undefined) clearTimeout(existing)
    const now = Date.now()
    const first = firstScheduled.get(token)
    if (first === undefined) firstScheduled.set(token, now)
    const delay = first !== undefined && now - first >= MAX_WAIT_MS ? 0 : DEBOUNCE_MS
    pending.set(
      token,
      setTimeout(() => {
        pending.delete(token)
        firstScheduled.delete(token)
        if (!disposed) run()
      }, delay)
    )
  }

  const cancel = (token: object): void => {
    const timer = pending.get(token)
    if (timer !== undefined) clearTimeout(timer)
    pending.delete(token)
    firstScheduled.delete(token)
  }

  // L-9: per-portal retry budget for portals whose shadowRoot appears after
  // insertion (dev only). WeakMap so removed portals don't retain entries.
  const MAX_SHADOW_ATTEMPTS = 3
  const shadowAttempts = new WeakMap<Element, number>()

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
        shadowAttempts.delete(portal) // attached: a future detach may retry again
        rebrandPortal(portal.shadowRoot)
      } else if (dev) {
        // DEV-only bounded retry: a portal can be INSERTED before its
        // attachShadow() call, and with a null shadowRoot no later light-DOM
        // mutation ever triggers another scan — the rebrand would never
        // happen. Re-scan via the existing debounce, capped at
        // MAX_SHADOW_ATTEMPTS follow-ups so a permanently shadow-less portal
        // cannot loop forever. Gated on `dev` so production keeps its
        // strictly one-shot, zero-timer story (H-05).
        const attempts = shadowAttempts.get(portal) ?? 0
        if (attempts < MAX_SHADOW_ATTEMPTS) {
          shadowAttempts.set(portal, attempts + 1)
          schedule(portal, scanPortals)
        }
      }
    }
    for (const [root, observer] of rootObservers) {
      if (!activeRoots.has(root)) {
        observer.disconnect()
        observers.delete(observer)
        rootObservers.delete(root)
        // L-10: a debounce timer already scheduled for this root would fire
        // into the now-detached shadow tree, re-creating overlay styles
        // nobody can see (and retaining the removed portal via the closure).
        cancel(root)
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

  // PRODUCTION: the loader prepends this module ahead of application code, so
  // the synchronous scan above provably runs before any portal exists — one
  // shot at module init would rebrand nothing. Re-scan once at DOM ready
  // (portals mount during initial render). Still strictly zero observers:
  // this is a single event, not a watch (H-05 holds).
  if (!dev && !disposed && doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', () => scanPortals(), { once: true })
  }

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
      firstScheduled.clear()
      for (const observer of observers) observer.disconnect()
      observers.clear()
      rootObservers.clear()
    },
    observerCount() {
      return observers.size
    },
  }
}

// L-12: the active runtime handle (undefined = nothing installed). Module
// level so the import side-effect and explicit install calls share ONE
// observer tree; cleared by the wrapped dispose() so re-install is fresh.
let activeRuntime: OverlayRuntime | null = null

/** Install both halves. Returns the overlay handle (disposable) or null. */
export function installBlazefireRuntime(doc?: Document): OverlayRuntime | null {
  if (typeof document === 'undefined' && doc === undefined) return null // SSR-safe
  const d = doc ?? document!

  // L-12 singleton: this module auto-installs on import (see the side-effect
  // below) AND is exported for consumers who want the dispose handle the
  // side-effect discards. A second call used to stack a SECOND full observer
  // tree with its own `disposed` flag — two trees, one dispose. Return the
  // active handle instead (injectStyles is already idempotent). Only a live
  // handle memoizes: with the overlay half disabled there is no tree to
  // stack, and SSR/null must stay caller-visible.
  if (activeRuntime) return activeRuntime

  if (THEME_ENABLED) injectStyles(d)
  if (OVERLAY_ENABLED) {
    const runtime = installOverlayRuntime(!IS_PRODUCTION, d)
    const innerDispose = runtime.dispose.bind(runtime)
    // Wrap dispose so the memo clears: a later call installs FRESH instead of
    // handing back a disposed (dead) handle. The `active === runtime` guard
    // keeps a stale second dispose from clearing a NEWER install.
    runtime.dispose = () => {
      if (activeRuntime === runtime) activeRuntime = null
      innerDispose()
    }
    activeRuntime = runtime
    return runtime
  }
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
