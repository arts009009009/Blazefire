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

describe('installOverlayRuntime', () => {
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

describe('installBlazefireRuntime', () => {
  it('is SSR-safe: null with no document', () => {
    const { installBlazefireRuntime } = require('../src/runtime/inject') as typeof import('../src/runtime/inject')
    expect(installBlazefireRuntime(undefined)).toBeNull()
  })
})
