/**
 * Test setup:
 *
 *   1. `MessageChannel` polyfill for jsdom suites — jsdom does not implement
 *      it, but React's browser builds (react-dom/client scheduler and
 *      react-dom/server.browser) import-time use it. Node provides a native
 *      one in the node environment, so this only installs where missing.
 *   2. quiet the `say()` chatter from the CLI helpers.
 *
 * `postinstall.cjs` / `plugin.cjs` log progress via `say()` (console.log with
 * a "blazefire:" prefix). That is correct CLI behaviour but pure noise across
 * 40+ tests. Only those lines are swallowed — any other console output (and
 * the full output of a failing test) still shows.
 */

'use strict'

// jsdom does not expose TextEncoder/TextDecoder as globals (React's browser
// server build uses TextEncoder). Node ships both in `util`.
if (typeof globalThis.TextEncoder === 'undefined') {
  const util = require('util')
  globalThis.TextEncoder = util.TextEncoder
  globalThis.TextDecoder = util.TextDecoder
}

if (typeof MessageChannel === 'undefined') {
  class JestMessageChannel {
    constructor() {
      const self = this
      this.port1 = { onmessage: null }
      this.port2 = {
        postMessage(data) {
          // Microtask delivery matches how React's scheduler treats the
          // channel (a prompt-but-async hint to yield).
          queueMicrotask(() => {
            if (typeof self.port1.onmessage === 'function') {
              self.port1.onmessage({ data })
            }
          })
        },
      }
    }
  }
  globalThis.MessageChannel = JestMessageChannel
}

const originalLog = console.log.bind(console)

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation((...args) => {
    if (
      typeof args[0] === 'string' &&
      args[0].trimStart().startsWith('blazefire:')
    )
      return
    originalLog(...args)
  })
})

afterEach(() => {
  jest.restoreAllMocks()
})
