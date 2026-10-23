import React from 'react';

export interface BlazefireLogoProps {
  size?: number;
  className?: string;
}

export function BlazefireLogo({ size = 40, className = '' }: BlazefireLogoProps): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      className={className}
    >
      <defs>
        <linearGradient
          id="blazefire_flame_gradient"
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
        <filter id="blazefire_glow">
          <feGaussianBlur stdDeviation="1" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter="url(#blazefire_glow)">
        <path
          d="M20 3 C20 3 30 14 30 23 C30 28 25.5 32 20 32 C14.5 32 10 28 10 23 C10 14 20 3 20 3Z"
          fill="url(#blazefire_flame_gradient)"
        />
        <path
          d="M20 11 C20 11 25 18 25 23 C25 25.8 22.8 28 20 28 C17.2 28 15 25.8 15 23 C15 18 20 11 20 11Z"
          fill="url(#blazefire_flame_gradient)"
          opacity="0.6"
        />
        <path
          d="M20 16 C20 16 22.5 20 22.5 23 C22.5 24.4 21.4 25.5 20 25.5 C18.6 25.5 17.5 24.4 17.5 23 C17.5 20 20 16 20 16Z"
          fill="#ffcc00"
          opacity="0.8"
        />
      </g>
    </svg>
  );
}

export interface BlazefireDevToolsIndicatorProps {
  isOpen: boolean;
  onClick: () => void;
}

export function BlazefireDevToolsIndicator({
  isOpen,
  onClick
}: BlazefireDevToolsIndicatorProps): React.ReactElement {
  return (
    <button
      className="blazefire-devtools-button"
      onClick={onClick}
      aria-label={`${isOpen ? 'Close' : 'Open'} Blazefire Dev Tools`}
      style={{
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        width: '40px',
        height: '40px',
        borderRadius: '50%',
        background: '#000000',
        border: '1px solid rgba(0, 255, 255, 0.3)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 0 10px rgba(0, 255, 255, 0.3)',
        zIndex: 2147483647
      }}
    >
      <BlazefireLogo size={28} />
    </button>
  );
}
