'use client'

import React, { useState, useEffect } from 'react'
import { BlazefireLogo } from './BlazefireLogo.js'
import { useBlazefire } from '../index.js'

var positionStyles = {
  'bottom-right': { bottom: 20, right: 20 },
  'bottom-left': { bottom: 20, left: 20 },
  'top-right': { top: 20, right: 20 },
  'top-left': { top: 20, left: 20 },
}

var rowStyles = {
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  gap: '2px 10px',
  margin: 0,
}
var labelStyles = { color: '#666' }
var valueStyles = { margin: 0 }

function DevToolsPanel(props) {
  return React.createElement(
    'div',
    {
      role: 'dialog',
      'aria-label': 'Blazefire Dev Tools',
      style: {
        background: '#000',
        border: '1px solid rgba(0,255,255,0.3)',
        borderRadius: 8,
        boxShadow: '0 0 20px rgba(0,255,255,0.2)',
        padding: '10px 12px',
        minWidth: 180,
        color: '#e0e0e0',
        fontSize: 12,
        lineHeight: '18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      },
    },
    React.createElement(
      'div',
      {
        style: {
          fontWeight: 600,
          fontSize: 13,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          background: 'linear-gradient(90deg, #ff8800, #ff006e)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        },
      },
      'Blazefire'
    ),
    React.createElement(
      'dl',
      { style: rowStyles },
      React.createElement('dt', { style: labelStyles }, 'Version'),
      React.createElement('dd', { style: valueStyles }, props.version),
      React.createElement('dt', { style: labelStyles }, 'Compiler'),
      React.createElement('dd', { style: valueStyles }, props.compiler),
      React.createElement('dt', { style: labelStyles }, 'Runtime'),
      React.createElement('dd', { style: valueStyles }, props.runtime)
    )
  )
}

export function BlazefireDevTools(props) {
  var position = props.position || 'bottom-right'
  var isOpenState = useState(false)
  var setIsOpen = isOpenState[1]
  var mountedState = useState(false)
  var setMounted = mountedState[1]
  var ctx = useBlazefire()

  useEffect(function () {
    setMounted(true)
  }, [])

  if (!mountedState[0]) return null

  var showPanelFirst = position.indexOf('bottom') === 0
  var panel = isOpenState[0]
    ? React.createElement(DevToolsPanel, {
        key: 'panel',
        version: ctx.version,
        compiler: ctx.compiler,
        runtime: ctx.runtime,
      })
    : null

  var children = [showPanelFirst ? panel : null]
  children.push(
    React.createElement(
      'button',
      {
        key: 'button',
        type: 'button',
        onClick: function () {
          setIsOpen(function (v) {
            return !v
          })
        },
        'aria-expanded': isOpenState[0],
        'aria-label':
          (isOpenState[0] ? 'Close' : 'Open') + ' Blazefire Dev Tools',
        style: {
          width: 40,
          height: 40,
          borderRadius: '50%',
          background: '#000',
          border: '1px solid rgba(0,255,255,0.3)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 0 10px rgba(0,255,255,0.3)',
          padding: 0,
        },
      },
      React.createElement(BlazefireLogo, { size: 28 })
    )
  )
  if (!showPanelFirst) children.push(panel)

  return React.createElement(
    'div',
    {
      style: Object.assign(
        {
          position: 'fixed',
          zIndex: 2147483647,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          alignItems:
            position.indexOf('-left') !== -1 ? 'flex-start' : 'flex-end',
        },
        positionStyles[position]
      ),
    },
    children
  )
}
