/**
 * Blazefire TypeScript Entry Point
 */

import React, { createContext, useContext, useEffect } from 'react';

export interface BlazefireConfig {
  theme?: 'dark' | 'light';
  primaryColor?: string;
  enableGlow?: boolean;
}

export interface CompilerOptions {
  jsc?: {
    parser?: { syntax: string; tsx?: boolean };
    transform?: { react?: { runtime: string } };
  };
  module?: { type: string };
}

export interface CompilerInstance {
  options: CompilerOptions;
  version: string;
  transform(code: string, filename?: string): Promise<{ code: string }>;
}

export const BLAZEFIRE_VERSION = '1.0.0';
export const FROSTFAST_VERSION = '1.0.0';
const BLAZEFIRE_LOGO_URL = new URL('../assets/blazefire-logo.png', import.meta.url).href;

export function insertBlazefireStyles(): void {
  if (typeof document === 'undefined') return;

  const existing = document.getElementById('blazefire-styles');
  if (existing) return;

  const style = document.createElement('style');
  style.id = 'blazefire-styles';
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
    html { color-scheme: dark; }
  `;
  document.head.appendChild(style);
}

export function createBlazefireLogo(size: number = 40): string {
  return `<img src="${BLAZEFIRE_LOGO_URL}" width="${size}" height="${size}" alt="Blazefire" style="object-fit:contain" draggable="false">`;
}

export function createCompiler(options: CompilerOptions = {}): CompilerInstance {
  const defaultOptions: CompilerOptions = {
    jsc: {
      parser: { syntax: 'typescript', tsx: true },
      transform: { react: { runtime: 'automatic' } },
    },
    module: { type: 'es6' },
  };

  const merged = { ...defaultOptions, ...options };

  return {
    options: merged,
    version: FROSTFAST_VERSION,
    async transform(code: string, _filename?: string) {
      return { code };
    },
  };
}

interface BlazefireContextValue {
  version: string;
  compiler: string;
}

const BlazefireContext = createContext<BlazefireContextValue>({
  version: BLAZEFIRE_VERSION,
  compiler: 'frostfast',
});

export function useBlazefire(): BlazefireContextValue {
  return useContext(BlazefireContext);
}

export interface BlazefireProviderProps {
  children: React.ReactNode;
}

export function BlazefireProvider({ children }: BlazefireProviderProps) {
  useEffect(() => {
    insertBlazefireStyles();
  }, []);

  return (
    <BlazefireContext.Provider value={{ version: BLAZEFIRE_VERSION, compiler: 'frostfast' }}>
      {children}
    </BlazefireContext.Provider>
  );
}

const Blazefire = {
  version: BLAZEFIRE_VERSION,
  createCompiler,
  insertBlazefireStyles,
  createBlazefireLogo,
  BlazefireProvider,
  useBlazefire,
};

export default Blazefire;
