'use client'

import React, { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

interface BlazefireContextValue {
  compiler: 'frostfast' | 'webpack'
  theme: 'dark' | 'light'
  version: string
}

const BlazefireContext = createContext<BlazefireContextValue>({
  compiler: 'frostfast',
  theme: 'dark',
  version: '1.0.0',
})

export const useBlazefire = () => useContext(BlazefireContext)

export interface BlazefireProviderProps {
  children: ReactNode
  compiler?: 'frostfast' | 'webpack'
  theme?: 'dark' | 'light'
}

export function BlazefireProvider({
  children,
  compiler = 'frostfast',
  theme = 'dark',
}: BlazefireProviderProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return

    const existing = document.getElementById('blazefire-global-styles')
    if (existing) return

    const style = document.createElement('style')
    style.id = 'blazefire-global-styles'
    style.textContent = `
      :root {
        --blazefire-cyan: #00ffff;
        --blazefire-magenta: #ff00ff;
        --blazefire-red: #ff006e;
        --blazefire-green: #00ff41;
        --blazefire-orange: #ff8800;
        --blazefire-background: #000000;
      }

      @keyframes blazefire-pulse {
        0%, 100% { opacity: 0.6; }
        50% { opacity: 1; }
      }

      @keyframes blazefire-glow {
        0%, 100% { box-shadow: 0 0 5px rgba(0, 255, 255, 0.3); }
        50% { box-shadow: 0 0 15px rgba(0, 255, 255, 0.6), 0 0 30px rgba(255, 0, 255, 0.3); }
      }

      ::-webkit-scrollbar { width: 6px; height: 6px; }
      ::-webkit-scrollbar-track { background: #000000; }
      ::-webkit-scrollbar-thumb {
        background: linear-gradient(180deg, #00ffff, #ff00ff);
        border-radius: 3px;
      }
    `
    document.head.appendChild(style)
  }, [mounted])

  return (
    <BlazefireContext.Provider value={{ compiler, theme, version: '1.0.0' }}>
      {children}
    </BlazefireContext.Provider>
  )
}
