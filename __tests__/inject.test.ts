/**
 * Client runtime (H-05): production is one-shot with ZERO MutationObservers;
 * dev observers exist and can be disposed.
 *
 * A micro-DOM stub is enough — the runtime only touches createElement,
 * getElementById, querySelectorAll, appendChild, and observer calls.
 */

interface StubElement {
  id: string
  textContent: string
  children: StubElement[]
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
  querySelectorAll(selector: string): StubElement[]
}

class StubStyle implements StubElement {
  id = ''
  textContent = ''
  children: StubElement[] = []
  private attrs = new Map<string, string>()
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value)
  }
  querySelectorAll(): StubElement[] {
    return []
  }
}

function stubDocument(): Document {
  const head = {
    children: [] as StubElement[],
    appendChild(node: StubElement) {
      this.children.push(node)
    },
  }
  return {
    head,
    getElementById(id: string) {
      return head.children.find((c) => c.id === id) ?? null
    },
    createElement: () => new StubStyle(),
    addEventListener: () => undefined,
    querySelectorAll: () => [],
    documentElement: { children: [] as StubElement[] },
  } as unknown as Document
}

describe('injectStyles', () => {
  it('injects the theme once and is idempotent', () => {
    const { injectStyles } = require('../src/runtime/inject') as typeof import('../src/runtime/inject')
    const doc = stubDocument()

    const first = injectStyles(doc)
    expect(first).not.toBeNull()
    expect(first!.id).toBe('blazefire-styles')
    expect(first!.textContent).toContain('--blazefire-cyan')

    const second = injectStyles(doc)
    expect(second).toBeNull() // already present
  })

  it('appends immediately with no listener when the document is already parsed', () => {
    const addEventListener = jest.fn()
    const doc = {
      ...stubDocument(),
      readyState: 'complete',
      addEventListener,
    } as unknown as Document

    const { injectStyles } = require('../src/runtime/inject') as typeof import('../src/runtime/inject')
    const style = injectStyles(doc)
    expect(style).not.toBeNull()
    expect(doc.getElementById('blazefire-styles')).toBe(style) // landed synchronously
    expect(addEventListener).not.toHaveBeenCalled() // nothing left to wait for
  })

  it('registers exactly ONE once-listener while head is missing during load', () => {
    const addEventListener = jest.fn()
    const head = {
      children: [] as StubElement[],
      appendChild(node: StubElement) {
        this.children.push(node)
      },
    }
    const doc = {
      head: null as unknown,
      getElementById(id: string) {
        return head.children.find((c) => c.id === id) ?? null
      },
      createElement: () => new StubStyle(),
      addEventListener,
      readyState: 'loading',
      querySelectorAll: () => [],
    } as unknown as Document

    const { injectStyles } = require('../src/runtime/inject') as typeof import('../src/runtime/inject')
    const first = injectStyles(doc)
    // The style never landed (no head), so the idempotency guard cannot fire
    // and a second call reaches the retry branch — it must NOT stack a
    // second listener (pre-fix: one leaked listener + orphan style per call).
    const second = injectStyles(doc)
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(addEventListener).toHaveBeenCalledTimes(1)
    const [type, handler, options] = addEventListener.mock.calls[0] as [
      string,
      () => void,
      { once: boolean },
    ]
    expect(type).toBe('DOMContentLoaded')
    expect(options).toEqual({ once: true })

    // The event fires once head exists: exactly one style lands, and it is
    // the first call's element (the second call's element stays orphaned
    // garbage, never registered, never retained by a listener).
    ;(doc as { head: unknown }).head = head
    handler()
    expect(head.children.filter((c) => c.id === 'blazefire-styles')).toHaveLength(1)
    expect(doc.getElementById('blazefire-styles')).toBe(first)
  })

  it('does not register a dead listener when loading already finished without a head', () => {
    const addEventListener = jest.fn()
    const doc = {
      ...stubDocument(),
      head: null,
      readyState: 'complete',
      addEventListener,
    } as unknown as Document

    const { injectStyles } = require('../src/runtime/inject') as typeof import('../src/runtime/inject')
    const style = injectStyles(doc)
    expect(style).not.toBeNull()
    // DOMContentLoaded has already fired: a listener would NEVER run again
    // (the pre-fix behavior — unstyled page, silent). Nothing to retry on.
    expect(addEventListener).not.toHaveBeenCalled()
  })
})

describe('blazefireLoader', () => {
  it('resolves the runtime from the package, not from the matched host file', () => {
    const { dirname, relative } = require('node:path') as typeof import('node:path')
    const {
      blazefireLoader,
      runtimeEntryPath,
    } = require('../src/runtime/turbopack-loader') as typeof import('../src/runtime/turbopack-loader')
    const resourcePath = '/host/node_modules/next/dist/client/app-next.js'
    const expected = relative(dirname(resourcePath), runtimeEntryPath())

    const result = blazefireLoader.call({ resourcePath }, 'export const app = true')
    expect(result).toContain(`import "${expected}";`)
    expect(result).toContain('export const app = true')
  })

  it('shifts an OBJECT-typed map and delivers code + shifted map via callback', () => {
    const { blazefireLoader } = require('../src/runtime/turbopack-loader') as typeof import('../src/runtime/turbopack-loader')
    const callback = jest.fn()
    const map = { version: 3, sources: ['a.ts'], names: [], mappings: 'AAAA;AACA' }

    const result = blazefireLoader.call(
      { resourcePath: '/host/app.js', callback },
      'export const a = 1',
      map
    )

    // Delivered through the async channel: undefined return, (null, code, map).
    expect(result).toBeUndefined()
    expect(callback).toHaveBeenCalledTimes(1)
    const [error, code, delivered] = callback.mock.calls[0] as [Error | null, string, string]
    expect(error).toBeNull()
    expect(code).toContain('/* blazefire-injected */')
    expect(code).toContain('export const a = 1')

    // The map shifted down ONE generated line and kept its JSON shape.
    const parsed = JSON.parse(delivered) as typeof map
    expect(parsed.mappings).toBe(';AAAA;AACA')
    expect(parsed.sources).toEqual(['a.ts'])
    expect(parsed.version).toBe(3)
    // The bundler's own object was not mutated in place.
    expect(map.mappings).toBe('AAAA;AACA')
  })

  it('shifts a STRING-typed map via callback', () => {
    const { blazefireLoader } = require('../src/runtime/turbopack-loader') as typeof import('../src/runtime/turbopack-loader')
    const callback = jest.fn()
    const map = JSON.stringify({ version: 3, sources: ['a.ts'], mappings: 'AAAA' })

    blazefireLoader.call({ resourcePath: '/host/app.js', callback }, 'export const b = 2', map)

    expect(callback).toHaveBeenCalledTimes(1)
    const [, code, delivered] = callback.mock.calls[0] as [Error | null, string, string]
    expect(code).toContain('export const b = 2')
    expect((JSON.parse(delivered) as { mappings: string }).mappings).toBe(';AAAA')
  })

  it('still returns shifted code when a map exists but no callback is available', () => {
    const { blazefireLoader } = require('../src/runtime/turbopack-loader') as typeof import('../src/runtime/turbopack-loader')
    // Documented constraint: a sync string return can carry ONLY code — the
    // loader API has no slot for a map (maps travel through `callback`), so
    // with no callback the shifted code goes out and the input map cannot be
    // shifted with it. Real webpack/turbopack contexts always pass `callback`.
    const result = blazefireLoader.call(
      { resourcePath: '/host/app.js' },
      'export const c = 3',
      { version: 3, mappings: 'AAAA' }
    )
    expect(typeof result).toBe('string')
    expect(result).toContain('/* blazefire-injected */')
    expect(result).toContain('export const c = 3')
  })
})

describe('installOverlayRuntime', () => {
  it('reports same-length branding changes as DOM changes', () => {
    const { applyOverlayToRoot } = require('../src/runtime/inject') as typeof import('../src/runtime/inject')
    const textNode = { nodeType: 3, data: 'Turbopack', nextSibling: null }
    const label = {
      firstChild: textNode,
      getAttribute: () => null,
      setAttribute: () => undefined,
    }
    const styles: StubElement[] = []
    const root = {
      getElementById: (id: string) => styles.find((style) => style.id === id) ?? null,
      querySelectorAll: (selector: string) =>
        selector === '.turbopack-text' ? [label] : [],
      appendChild: (style: StubElement) => styles.push(style),
    } as unknown as ShadowRoot

    expect(applyOverlayToRoot(root, stubDocument())).toBe(true)
    expect(textNode.data).toBe('Frostfast')
    expect(textNode.data).toHaveLength('Turbopack'.length)
    expect(applyOverlayToRoot(root, stubDocument())).toBe(false)
  })

  it('constructs ZERO observers in production mode (dev=false)', () => {
    const created: unknown[] = []
    const RealMO = global.MutationObserver
    global.MutationObserver = class {
      constructor() {
        created.push(this)
      }
      observe() {}
      disconnect() {}
    } as unknown as typeof MutationObserver

    try {
      const { installOverlayRuntime } = require('../src/runtime/inject') as typeof import('../src/runtime/inject')
      const runtime = installOverlayRuntime(false, stubDocument())
      expect(created).toHaveLength(0) // H-05: no production observers, ever
      expect(runtime.observerCount()).toBe(0)
      runtime.dispose()
      expect(runtime.observerCount()).toBe(0)
    } finally {
      global.MutationObserver = RealMO
    }
  })

  it('re-scans once at DOM ready in production (the init scan runs before any portal exists)', () => {
    const handlers = new Map<string, () => void>()
    let scans = 0
    const doc = {
      ...stubDocument(),
      readyState: 'loading',
      addEventListener: (type: string, cb: () => void) => handlers.set(type, cb),
      querySelectorAll: () => {
        scans += 1
        return []
      },
    } as unknown as Document

    const { installOverlayRuntime } = require('../src/runtime/inject') as typeof import('../src/runtime/inject')
    const runtime = installOverlayRuntime(false, doc)
    expect(scans).toBe(1) // module-init scan (provably empty at that point)

    handlers.get('DOMContentLoaded')?.()
    expect(scans).toBe(2) // the one-shot re-scan that can actually see portals
    expect(runtime.observerCount()).toBe(0) // still ZERO observers (H-05)
    runtime.dispose()
  })

  it('registers no DOM-ready listener when the document is already parsed', () => {
    const handlers = new Map<string, () => void>()
    const doc = {
      ...stubDocument(),
      readyState: 'complete',
      addEventListener: (type: string, cb: () => void) => handlers.set(type, cb),
      querySelectorAll: () => [],
    } as unknown as Document

    const { installOverlayRuntime } = require('../src/runtime/inject') as typeof import('../src/runtime/inject')
    const runtime = installOverlayRuntime(false, doc)
    expect(handlers.has('DOMContentLoaded')).toBe(false)
    runtime.dispose()
  })

  it('creates a portal observer in dev mode and releases it on dispose', () => {
    const instances: Array<{ disconnected: boolean; observe: () => void }> = []
    const RealMO = global.MutationObserver
    global.MutationObserver = class {
      disconnected = false
      observe() {}
      disconnect() {
        this.disconnected = true
      }
      constructor() {
        instances.push(this)
      }
    } as unknown as typeof MutationObserver

    try {
      const { installOverlayRuntime } = require('../src/runtime/inject') as typeof import('../src/runtime/inject')
      const runtime = installOverlayRuntime(true, stubDocument())
      expect(instances.length).toBe(1) // the document-level portal watcher
      expect(runtime.observerCount()).toBe(1)

      runtime.dispose()
      expect(runtime.observerCount()).toBe(0)
      expect(instances[0]!.disconnected).toBe(true)

      runtime.dispose() // idempotent
      expect(runtime.observerCount()).toBe(0)
    } finally {
      global.MutationObserver = RealMO
    }
  })
})

it('keeps portal observers for late overlay updates and disconnects on removal', () => {
  const instances: Array<{
    callback: MutationCallback
    disconnected: boolean
    observe: () => void
    disconnect: () => void
    trigger: () => void
  }> = []
  const RealMO = global.MutationObserver
  global.MutationObserver = class {
    disconnected = false
    callback: MutationCallback
    constructor(callback: MutationCallback) {
      this.callback = callback
      instances.push(this)
    }
    observe() {}
    disconnect() {
      this.disconnected = true
    }
    trigger() {
      this.callback([], this as unknown as MutationObserver)
    }
  } as unknown as typeof MutationObserver

  const root = {
    getElementById: () => null,
    querySelectorAll: () => [],
    appendChild: () => undefined,
  } as unknown as ShadowRoot
  const portal = { shadowRoot: root } as unknown as Element
  let portalPresent = true
  const queryAll = jest.fn(() => (portalPresent ? [portal] : []))
  const doc = {
    ...stubDocument(),
    querySelectorAll: queryAll,
  } as unknown as Document

  jest.useFakeTimers()
  try {
    const { installOverlayRuntime } = require('../src/runtime/inject') as typeof import('../src/runtime/inject')
    const runtime = installOverlayRuntime(true, doc)
    expect(runtime.observerCount()).toBe(2)
    expect(queryAll).toHaveBeenCalledTimes(1) // the synchronous initial scan

    // Shadow-root mutation bursts stay debounced and never disconnect anything.
    for (let i = 0; i < 5; i++) instances[0]!.trigger()
    jest.advanceTimersByTime(150)
    expect(runtime.observerCount()).toBe(2)
    expect(instances[0]!.disconnected).toBe(false)

    // A burst of PORTAL mutations coalesces into ONE debounced re-scan.
    for (let i = 0; i < 5; i++) instances[1]!.trigger()
    expect(queryAll).toHaveBeenCalledTimes(1) // nothing yet — still debouncing
    jest.advanceTimersByTime(150)
    expect(queryAll).toHaveBeenCalledTimes(2) // the whole burst ran once
    expect(instances[0]!.disconnected).toBe(false) // portal still present

    portalPresent = false
    instances[1]!.trigger()
    jest.advanceTimersByTime(150) // trailing scan sees the portal gone
    expect(runtime.observerCount()).toBe(1)
    expect(instances[0]!.disconnected).toBe(true)
    runtime.dispose()
    expect(runtime.observerCount()).toBe(0)
  } finally {
    jest.useRealTimers()
    global.MutationObserver = RealMO
  }
})

describe('installBlazefireRuntime', () => {
  it('is SSR-safe: null with no document', () => {
    const { installBlazefireRuntime } = require('../src/runtime/inject') as typeof import('../src/runtime/inject')
    expect(installBlazefireRuntime(undefined)).toBeNull()
  })
})
