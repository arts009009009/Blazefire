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

    // A burst of mutations must coalesce into ONE debounced re-scan.
    for (let i = 0; i < 5; i++) instances[0]!.trigger()
    expect(queryAll).toHaveBeenCalledTimes(1) // nothing yet — still debouncing
    jest.advanceTimersByTime(150)
    expect(queryAll).toHaveBeenCalledTimes(2) // the whole burst ran once
    expect(runtime.observerCount()).toBe(2)
    expect(instances[0]!.disconnected).toBe(false)

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
