'use client'

import React, { useState, useEffect, useRef } from 'react'
import { BlazefireLogo } from './BlazefireLogo.js'

export function BlazefireErrorOverlay(props) {
  var errorType = props.errorType
  var errorMessage = props.errorMessage
  var onClose = props.onClose
  var children = props.children
  var mounted = useState(false)
  var setMounted = mounted[1]
  var panelRef = useRef(null)

  useEffect(function () {
    setMounted(true)
  }, [])

  // Accessibility: once visible, move focus into the dialog so keyboard and
  // screen-reader users land on it, allow Escape to close (when closable), and
  // restore focus on unmount. Runs only after the mounted gate opens, so it
  // never touches the DOM during SSR.
  useEffect(
    function () {
      if (!mounted[0]) return
      var previous = document.activeElement
      if (panelRef.current && panelRef.current.focus) panelRef.current.focus()

      if (!onClose) {
        return function () {
          if (previous && previous.focus) previous.focus()
        }
      }
      function onKeyDown(event) {
        if (event.key === 'Escape') onClose()
      }
      document.addEventListener('keydown', onKeyDown)
      return function () {
        document.removeEventListener('keydown', onKeyDown)
        if (previous && previous.focus) previous.focus()
      }
    },
    [mounted[0], onClose]
  )

  if (!mounted[0]) return null

  return React.createElement(
    'div',
    {
      role: 'presentation',
      style: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2147483647,
      },
    },
    React.createElement(
      'div',
      {
        ref: panelRef,
        role: 'alertdialog',
        'aria-modal': true,
        'aria-label': 'Blazefire error overlay',
        tabIndex: -1,
        style: {
          background: '#000',
          border: '1px solid rgba(0,255,255,0.2)',
          borderRadius: 8,
          maxWidth: '90vw',
          maxHeight: '80vh',
          overflow: 'auto',
          boxShadow: '0 0 30px rgba(0,255,255,0.15)',
          position: 'relative',
          outline: 'none',
        },
      },
      React.createElement(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 16px',
            background:
              'linear-gradient(135deg, rgba(0,255,255,0.05), rgba(255,0,255,0.05))',
            borderBottom: '1px solid rgba(0,255,255,0.15)',
          },
        },
        React.createElement(BlazefireLogo, { size: 28 }),
        React.createElement(
          'span',
          {
            style: {
              fontSize: 14,
              fontWeight: 600,
              background: 'linear-gradient(90deg, #ff8800, #ff006e)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              textTransform: 'uppercase',
            },
          },
          'Blazefire'
        )
      ),
      React.createElement(
        'div',
        { style: { padding: 16 } },
        React.createElement(
          'span',
          {
            style: {
              padding: '2px 6px',
              borderRadius: 4,
              background: 'rgba(255,0,110,0.15)',
              fontWeight: 600,
              fontSize: 12,
              color: '#ff006e',
              border: '1px solid rgba(255,0,110,0.3)',
            },
          },
          errorType
        ),
        React.createElement(
          'div',
          {
            style: {
              marginTop: 12,
              color: '#ff006e',
              fontWeight: 500,
              fontSize: 16,
              lineHeight: '24px',
            },
          },
          errorMessage
        ),
        children
      ),
      onClose &&
        React.createElement(
          'button',
          {
            type: 'button',
            onClick: onClose,
            'aria-label': 'Close error overlay',
            style: {
              position: 'absolute',
              top: 12,
              right: 12,
              background: 'none',
              border: 'none',
              color: '#666',
              cursor: 'pointer',
              fontSize: 18,
            },
          },
          '\u00d7'
        )
    )
  )
}
