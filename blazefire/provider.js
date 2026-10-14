/**
 * Blazefire React context — the client half of the entry point.
 *
 * This file carries the `'use client'` directive so `<BlazefireProvider>` and
 * `useBlazefire()` work when they are reached from a React Server Component.
 * The directive belongs here rather than on the entry (`index.js`) because the
 * entry also exports plain utilities: marking the entry would turn those into
 * client references too, and calling `insertBlazefireStyles()` from a Server
 * Component would then throw.
 */

'use client'

import React, { createContext, useContext, useEffect } from 'react'
import { BLAZEFIRE_VERSION, insertBlazefireStyles } from './utils.js'

const BlazefireContext = createContext({
  version: BLAZEFIRE_VERSION,
  compiler: 'frostfast',
  runtime: 'blazefire',
})

export function useBlazefire() {
  return useContext(BlazefireContext)
}

function BlazefireDevToolsAuto() {
  var isDev =
    typeof process !== 'undefined' &&
    process.env &&
    process.env.NODE_ENV === 'development'
  if (!isDev) return null
  return React.createElement('div', {
    'data-blazefire-devtools': true,
    role: 'status',
    style: { position: 'fixed', bottom: 20, right: 20, zIndex: 2147483647 },
    'aria-label': 'Blazefire Dev Tools',
  })
}

export function BlazefireProvider(props) {
  useEffect(function () {
    insertBlazefireStyles()
  }, [])

  return React.createElement(
    BlazefireContext.Provider,
    {
      value: {
        version: BLAZEFIRE_VERSION,
        compiler: 'frostfast',
        runtime: 'blazefire',
      },
    },
    props.children,
    React.createElement(BlazefireDevToolsAuto, null)
  )
}
