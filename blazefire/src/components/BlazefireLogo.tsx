import React from 'react';

const logoUrl = new URL('../../assets/blazefire-logo.png', import.meta.url).href;

export interface BlazefireLogoProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function BlazefireLogo({ size = 40, className = '', style }: BlazefireLogoProps) {
  return (
    <img
      src={logoUrl}
      width={size}
      height={size}
      alt="Blazefire"
      draggable={false}
      className={className}
      style={{ objectFit: 'contain', ...style }}
    >
    />
  );
}
