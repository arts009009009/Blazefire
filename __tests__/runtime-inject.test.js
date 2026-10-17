/**
 * Integration tests for the injected client runtime (`blazefire/runtime/inject.cjs`).
 *
 * The runtime executes at import time (it is prepended to Next's client
 * entry), so every test builds its DOM first, loads a fresh module instance,
 * and asserts on the resulting DOM. jsdom provides document, shadow roots and
 * MutationObserver — exactly the surface the runtime touches.
 *
 * @jest-environment jsdom
 */

'use strict'

const pkg = require('../package.json')

/** Fresh, uncached copy of the runtime (it runs on import). */
function loadRuntime() {
  let mod
  jest.isolateModules(() => {
    mod = require('../blazefire/runtime/inject.cjs')
  })
  return mod
}

/** One microtask-turn + a macrotask, enough for MutationObserver callbacks. */
const flushMutations = () => new Promise((resolve) => setTimeout(resolve, 10))

function makePortal(shadowHtml) {
  const portal = document.createElement('nextjs-portal')
  const shadow = portal.attachShadow({ mode: 'open' })
  shadow.innerHTML = shadowHtml
  document.body.appendChild(portal)
  return portal
}

const OVERLAY_HTML = `
  <div id="next-logo"><svg><text>N</text></svg></div>
  <div data-nextjs-version-checker>Next.js 16.3.8</div>
  <span class="turbopack-text">Turbopack</span>
  <button aria-label="Next.js Dev Tools">dev</button>
`

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_BLAZEFIRE_THEME
  delete process.env.NEXT_PUBLIC_BLAZEFIRE_OVERLAY
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  jest.resetModules()
})

afterEach(() => {
  delete process.env.NEXT_PUBLIC_BLAZEFIRE_THEME
  delete process.env.NEXT_PUBLIC_BLAZEFIRE_OVERLAY
})

describe('document theme injection', () => {
  it('appends an idempotent, version-tagged <style>', () => {
    loadRuntime()
    const styles = document.querySelectorAll('#blazefire-styles')
    expect(styles).toHaveLength(1)
    expect(styles[0].getAttribute('data-blazefire')).toBe(pkg.version)
    expect(styles[0].textContent).toContain('--blazefire-cyan')
  })

  it('does not duplicate the <style> when the runtime loads again', () => {
    loadRuntime()
    loadRuntime()
    expect(document.querySelectorAll('#blazefire-styles')).toHaveLength(1)
  })

  it('is a no-op when NEXT_PUBLIC_BLAZEFIRE_THEME=false', () => {
    process.env.NEXT_PUBLIC_BLAZEFIRE_THEME = 'false'
    process.env.NEXT_PUBLIC_BLAZEFIRE_OVERLAY = 'true'
    loadRuntime()
    expect(document.querySelectorAll('#blazefire-styles')).toHaveLength(0)
  })
})

describe('overlay rebrand (shadow root)', () => {
  it('injects the overlay stylesheet into the portal shadow root', () => {
    makePortal(OVERLAY_HTML)
    loadRuntime()
    const portal = document.querySelector('nextjs-portal')
    const style = portal.shadowRoot.getElementById('blazefire-overlay-styles')
    expect(style).not.toBeNull()
    expect(style.textContent).toContain('#next-logo')
  })

  it('rewrites Next’s literal brand text and labels', () => {
    makePortal(OVERLAY_HTML)
    loadRuntime()
    const root = document.querySelector('nextjs-portal').shadowRoot

    const versionChecker = root.querySelector('[data-nextjs-version-checker]')
    expect(versionChecker.textContent).toBe('Blazefire ' + pkg.version)
    expect(versionChecker.getAttribute('title')).toBe('Blazefire ' + pkg.version)

    expect(root.querySelector('.turbopack-text').textContent).toBe('Frostfast')

    const devTools = root.querySelector('button[aria-label*="Dev Tools"]')
    expect(devTools.getAttribute('aria-label')).toBe('Blazefire Dev Tools')
    expect(devTools.getAttribute('title')).toBe('Open Blazefire Dev Tools')
  })

  it('leaves nodes in place (React owns them — only text/attributes change)', () => {
    const portal = makePortal(OVERLAY_HTML)
    const root = portal.shadowRoot
    const before = root.querySelectorAll('*').length

    loadRuntime()

    // element count unchanged: nothing removed or re-parented
    expect(root.querySelectorAll('*').length).toBe(before)
    expect(root.querySelector('#next-logo')).not.toBeNull()
    expect(root.querySelector('.turbopack-text')).not.toBeNull()
    expect(root.querySelector('button')).not.toBeNull()
    // …but a style element was ADDED (attribute/text writes + one append)
    expect(root.querySelectorAll('*').length).toBe(before + 1)
  })

  it('is idempotent across runtime reloads', () => {
    makePortal(OVERLAY_HTML)
    loadRuntime()
    loadRuntime()
    const root = document.querySelector('nextjs-portal').shadowRoot
    expect(root.querySelectorAll('#blazefire-overlay-styles')).toHaveLength(1)
    expect(root.querySelector('[data-nextjs-version-checker]').textContent).toBe(
      'Blazefire ' + pkg.version
    )
  })

  it('heals when React re-renders Next’s strings back', async () => {
    makePortal(OVERLAY_HTML)
    loadRuntime()
    const root = document.querySelector('nextjs-portal').shadowRoot
    const versionChecker = root.querySelector('[data-nextjs-version-checker]')

    // Simulate React restoring the original text after a re-render.
    versionChecker.textContent = 'Next.js 16.3.8'
    await flushMutations()

    expect(versionChecker.textContent).toBe('Blazefire ' + pkg.version)
  })

  it('rebrands a portal that mounts after the runtime (body observer)', async () => {
    loadRuntime() // no portal yet
    expect(
      document.querySelector('nextjs-portal') ?? null
    ).toBeNull()

    makePortal(OVERLAY_HTML)
    await flushMutations()

    const root = document.querySelector('nextjs-portal').shadowRoot
    expect(root.querySelector('#blazefire-overlay-styles')).not.toBeNull()
    expect(root.querySelector('.turbopack-text').textContent).toBe('Frostfast')
  })

  it('skips the overlay when NEXT_PUBLIC_BLAZEFIRE_OVERLAY=false but keeps the theme', () => {
    process.env.NEXT_PUBLIC_BLAZEFIRE_OVERLAY = 'false'
    makePortal(OVERLAY_HTML)
    loadRuntime()

    expect(document.querySelectorAll('#blazefire-styles')).toHaveLength(1)
    const root = document.querySelector('nextjs-portal').shadowRoot
    expect(root.getElementById('blazefire-overlay-styles')).toBeNull()
    expect(root.querySelector('.turbopack-text').textContent).toBe('Turbopack')
  })

  it('applies the overlay when the theme is off but the overlay is on', () => {
    process.env.NEXT_PUBLIC_BLAZEFIRE_THEME = 'false'
    makePortal(OVERLAY_HTML)
    loadRuntime()

    expect(document.querySelectorAll('#blazefire-styles')).toHaveLength(0)
    const root = document.querySelector('nextjs-portal').shadowRoot
    expect(root.getElementById('blazefire-overlay-styles')).not.toBeNull()
    expect(root.querySelector('.turbopack-text').textContent).toBe('Frostfast')
  })
})
