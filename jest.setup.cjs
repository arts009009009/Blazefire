/**
 * Test setup: quiet the `say()` chatter from the CLI helpers.
 *
 * `postinstall.cjs` / `plugin.cjs` log progress via `say()` (console.log with
 * a "blazefire:" prefix). That is correct CLI behaviour but pure noise across
 * 40+ tests. Only those lines are swallowed — any other console output (and
 * the full output of a failing test) still shows.
 */

'use strict'

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
