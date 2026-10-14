'use client'

import React, { useState, useEffect } from 'react'
import { BlazefireLogo } from './BlazefireLogo.js'
import { useBlazefire } from '../index.js'

export interface BlazefireDevToolsProps {
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
}

export function BlazefireDevTools({
  position = 'bottom-right',
}: BlazefireDevToolsProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const { version, compiler, runtime } = useBlazefire()

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  const positionStyles: Record<string, React.CSSProperties> = {
    'bottom-right': { bottom: 20, right: 20 },
    'bottom-left': { bottom: 20, left: 20 },
    'top-right': { top: 20, right: 20 },
    'top-left': { top: 20, left: 20 },
  }

  // The panel sits away from the viewport edge: above the button for the
  // bottom positions, below it for the top ones, so neither is pushed off.
  const panel = isOpen ? (
    <div
      role="dialog"
      aria-label="Blazefire Dev Tools"
      style={{
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
      }}
    >
      <div
        style={{
          fontWeight: 600,
          fontSize: 13,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          background: 'linear-gradient(90deg, #ff8800, #ff006e)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}
      >
        Blazefire
      </div>
      <dl
        style={{
          margin: 0,
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: '2px 10px',
        }}
      >
        <dt style={{ color: '#666' }}>Version</dt>
        <dd style={{ margin: 0 }}>{version}</dd>
        <dt style={{ color: '#666' }}>Compiler</dt>
        <dd style={{ margin: 0 }}>{compiler}</dd>
        <dt style={{ color: '#666' }}>Runtime</dt>
        <dd style={{ margin: 0 }}>{runtime}</dd>
      </dl>
    </div>
  ) : null

  const showPanelFirst = position.startsWith('bottom')

  return (
    <div
      style={{
        position: 'fixed',
        ...positionStyles[position],
        zIndex: 2147483647,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        alignItems: position.endsWith('left') ? 'flex-start' : 'flex-end',
      }}
    >
      {showPanelFirst && panel}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-label={`${isOpen ? 'Close' : 'Open'} Blazefire Dev Tools`}
        style={{
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
        }}
      >
        <BlazefireLogo size={28} />
      </button>
      {!showPanelFirst && panel}
    </div>
  )
}
