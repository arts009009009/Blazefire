'use client'

import React from 'react'

export interface BlazefireLogoProps {
  size?: number
  className?: string
  style?: React.CSSProperties
}

/**
 * Self-contained Blazefire flame mark.
 *
 * Rendered as an inline <svg> so it works in any React runtime (server,
 * client, RSC) and any bundler without shipping or resolving an external
 * image asset — a <img src={new URL(...)} approach breaks once the package
 * is installed from a tarball that does not include the PNG, or when
 * `import.meta.url` is rewritten to a chunk URL in the browser.
 */
export function BlazefireLogo({
  size = 40,
  className = '',
  style,
}: BlazefireLogoProps) {
  // Unique per instance: rendering two Logos (e.g. the overlay and the
  // DevTools button) must not produce duplicate `blazefire-flame`/`blazefire-glow`
  // DOM ids, which browsers resolve to the first match. `useId` is stable
  // across server and client, so this stays hydration-safe; strip non-word
  // chars so the id is safe inside `url(#…)`.
  const uid = React.useId().replace(/[^a-zA-Z0-9]/g, '')
  const flameId = `blazefire-flame-${uid}`
  const glowId = `blazefire-glow-${uid}`
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Blazefire"
      className={className}
      style={{ display: 'inline-block', verticalAlign: 'middle', ...style }}
    >
      <defs>
        <linearGradient
          id={flameId}
          x1="20"
          y1="5"
          x2="20"
          y2="35"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#ff8800" />
          <stop offset="0.4" stopColor="#ff4400" />
          <stop offset="0.7" stopColor="#ff006e" />
          <stop offset="1" stopColor="#cc00cc" />
        </linearGradient>
        <filter
          id={glowId}
          x="-50%"
          y="-50%"
          width="200%"
          height="200%"
        >
          <feGaussianBlur stdDeviation="1" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter={`url(#${glowId})`}>
        <path
          d="M20 3C20 3 30 14 30 23C30 28 25.5 32 20 32C14.5 32 10 28 10 23C10 14 20 3 20 3Z"
          fill={`url(#${flameId})`}
        />
        <path
          d="M20 11C20 11 25 18 25 23C25 25.8 22.8 28 20 28C17.2 28 15 25.8 15 23C15 18 20 11 20 11Z"
          fill={`url(#${flameId})`}
          opacity="0.6"
        />
        <path
          d="M20 16C20 16 22.5 20 22.5 23C22.5 24.4 21.4 25.5 20 25.5C18.6 25.5 17.5 24.4 17.5 23C17.5 20 20 16 20 16Z"
          fill="#ffcc00"
          opacity="0.8"
        />
      </g>
    </svg>
  )
}
