/**
 * Behavioral tests for the shipped components (blazefire/src/components/*.js),
 * the React context (blazefire/provider.js), and their SSR safety.
 *
 * The component `.js` files are the shipped runtime (consumers resolve them
 * through the `blazefire/components/*` export); the `.tsx` siblings are the
 * types source. Everything here exercises the shipped files.
 *
 * @jest-environment jsdom
 */

'use strict'

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'

import { BlazefireLogo } from '../blazefire/src/components/BlazefireLogo.js'
import { BlazefireErrorOverlay } from '../blazefire/src/components/BlazefireErrorOverlay.js'
import { BlazefireDevTools } from '../blazefire/src/components/BlazefireDevTools.js'
import { BlazefireProvider, useBlazefire } from '../blazefire/provider.js'
import { insertBlazefireStyles } from '../blazefire/utils.js'

const pkg = require('../package.json')

// React's act() requires this flag in non-testing-library setups.
globalThis.IS_REACT_ACT_ENVIRONMENT = true

/** Render a React element into a fresh container; returns helpers. */
async function render(el) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(el)
  })
  const unmount = async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
  }
  return { container, root, unmount }
}

beforeEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
})

describe('server rendering (SSR)', () => {
  it('BlazefireLogo renders its svg inline', () => {
    const html = renderToString(<BlazefireLogo />)
    expect(html).toContain('<svg')
    expect(html).toContain('aria-label="Blazefire"')
    expect(html).toContain('width="40"')
    expect(html).toContain('height="40"')
  })

  it('BlazefireLogo honours size/className/style props', () => {
    const html = renderToString(
      <BlazefireLogo size={32} className="mark" style={{ opacity: 0.5 }} />
    )
    expect(html).toContain('width="32"')
    expect(html).toContain('class="mark"')
    expect(html).toContain('opacity')
  })

  it('BlazefireProvider renders children without any client effect', () => {
    const html = renderToString(
      <BlazefireProvider>
        <p>hello</p>
      </BlazefireProvider>
    )
    expect(html).toContain('<p>hello</p>')
    // no hydration-breaking markup: styles are injected in an effect, the
    // dev-tools marker only exists in development…
    expect(html).not.toContain('data-blazefire-devtools')
  })

  it('mounted-gated components render null on the server', () => {
    expect(
      renderToString(
        <BlazefireErrorOverlay errorType="Error" errorMessage="boom" />
      )
    ).toBe('')
    expect(renderToString(<BlazefireDevTools />)).toBe('')
  })
})

describe('BlazefireProvider (client)', () => {
  it('provides version/compiler/runtime through the context', async () => {
    let seen
    function Reader() {
      seen = useBlazefire()
      return null
    }
    const { unmount } = await render(
      <BlazefireProvider>
        <Reader />
      </BlazefireProvider>
    )
    expect(seen).toEqual({
      version: pkg.version,
      compiler: 'frostfast',
      runtime: 'blazefire',
    })
    await unmount()
  })

  it('injects the stylesheet in an effect (idempotent)', async () => {
    const { unmount } = await render(
      <BlazefireProvider>
        <span />
      </BlazefireProvider>
    )
    expect(document.querySelectorAll('#blazefire-styles')).toHaveLength(1)
    // a manual call after mount must not duplicate
    await act(async () => insertBlazefireStyles())
    expect(document.querySelectorAll('#blazefire-styles')).toHaveLength(1)
    await unmount()
  })

  it('renders the real DevTools indicator only under NODE_ENV=development', async () => {
    const original = process.env.NODE_ENV
    try {
      process.env.NODE_ENV = 'development'
      const dev = await render(
        <BlazefireProvider>
          <span />
        </BlazefireProvider>
      )
      // The provider mounts the actual BlazefireDevTools toggle (a button),
      // not the old inert placeholder div.
      const toggle = dev.container.querySelector(
        'button[aria-label="Open Blazefire Dev Tools"]'
      )
      expect(toggle).not.toBeNull()
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      await dev.unmount()

      process.env.NODE_ENV = 'production'
      const prod = await render(
        <BlazefireProvider>
          <span />
        </BlazefireProvider>
      )
      expect(
        prod.container.querySelector('[aria-label="Open Blazefire Dev Tools"]')
      ).toBeNull()
      await prod.unmount()
    } finally {
      process.env.NODE_ENV = original
    }
  })

  it('useBlazefire() outside a provider returns the documented defaults', () => {
    let seen
    function Reader() {
      seen = useBlazefire()
      return null
    }
    renderToString(<Reader />)
    expect(seen).toEqual({
      version: pkg.version,
      compiler: 'frostfast',
      runtime: 'blazefire',
    })
  })
})

describe('BlazefireErrorOverlay (client)', () => {
  it('stays hidden until mounted, then shows the branded error', async () => {
    const { container, unmount } = await render(
      <BlazefireErrorOverlay errorType="HydrationMismatch" errorMessage="Text">
        <div>extra</div>
      </BlazefireErrorOverlay>
    )
    // mounted gate passes after the effect, overlay content appears
    expect(container.textContent).toContain('HydrationMismatch')
    expect(container.textContent).toContain('Text')
    expect(container.textContent).toContain('Blazefire')
    expect(container.querySelector('div')?.textContent).toContain('extra')
    expect(container.querySelector('svg')).not.toBeNull()
    await unmount()
  })

  it('calls onClose when the close button is clicked', async () => {
    const onClose = jest.fn()
    const onSubmit = jest.fn((event) => event.preventDefault())
    const { container, unmount } = await render(
      <form onSubmit={onSubmit}>
        <BlazefireErrorOverlay
          errorType="Error"
          errorMessage="boom"
          onClose={onClose}
        />
      </form>
    )
    const buttons = [...container.querySelectorAll('button')]
    const close = buttons.find((b) => b.textContent === '×')
    expect(close).toBeDefined()
    expect(close.type).toBe('button')
    expect(close.getAttribute('aria-label')).toBe('Close error overlay')
    await act(async () => {
      close.click()
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
    await unmount()
  })

  it('renders no close button when onClose is omitted', async () => {
    const { container, unmount } = await render(
      <BlazefireErrorOverlay errorType="Error" errorMessage="boom" />
    )
    expect(container.querySelectorAll('button')).toHaveLength(0)
    await unmount()
  })
})

describe('BlazefireDevTools (client)', () => {
  it('is hidden until mounted, then exposes an accessible toggle', async () => {
    const { container, unmount } = await render(<BlazefireDevTools />)
    const button = container.querySelector('button')
    expect(button).not.toBeNull()
    expect(button.getAttribute('aria-label')).toBe('Open Blazefire Dev Tools')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    // panel closed by default
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    await unmount()
  })

  it('opens a dialog reading the context values (via provider)', async () => {
    const { container, unmount } = await render(
      <BlazefireProvider>
        <BlazefireDevTools />
      </BlazefireProvider>
    )
    const button = container.querySelector('button')
    await act(async () => {
      button.click()
    })

    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog.getAttribute('aria-label')).toBe('Blazefire Dev Tools')
    expect(dialog.textContent).toContain('Version')
    expect(dialog.textContent).toContain(pkg.version)
    expect(dialog.textContent).toContain('Compiler')
    expect(dialog.textContent).toContain('frostfast')
    expect(dialog.textContent).toContain('Runtime')
    expect(dialog.textContent).toContain('blazefire')

    expect(container.querySelector('button').getAttribute('aria-label')).toBe(
      'Close Blazefire Dev Tools'
    )
    expect(
      container.querySelector('button').getAttribute('aria-expanded')
    ).toBe('true')

    // toggle closes it again
    await act(async () => {
      container.querySelector('button').click()
    })
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    await unmount()
  })

  it('supports all four positions with the panel placed away from the edge', async () => {
    for (const position of [
      'bottom-right',
      'bottom-left',
      'top-right',
      'top-left',
    ]) {
      const { container, unmount } = await render(
        <BlazefireDevTools position={position} />
      )
      const wrapper = container.firstElementChild
      const style = wrapper.getAttribute('style')
      const [vertical, horizontal] = position.split('-')
      expect(style).toContain(vertical + ':')
      expect(style).toContain(horizontal + ':')

      // open and check the panel sits on the opposite side of the button
      await act(async () => {
        container.querySelector('button').click()
      })
      const button = container.querySelector('button')
      const dialog = container.querySelector('[role="dialog"]')
      if (vertical === 'bottom') {
        expect(button.previousElementSibling).toBe(dialog)
      } else {
        expect(button.nextElementSibling).toBe(dialog)
      }
      await unmount()
    }
  })

  it('renders an invalid position without crashing', async () => {
    const { container, unmount } = await render(
      <BlazefireDevTools position="center" />
    )
    expect(container.querySelector('button')).not.toBeNull()
    await unmount()
  })
})
