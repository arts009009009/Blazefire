/**
 * Blazefire TypeScript Entry Point
 */

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

export function insertBlazefireStyles(): void {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById('blazefire-styles');
  if (existing) return;
  const style = document.createElement('style');
  style.id = 'blazefire-styles';
  style.textContent = `:host{--blazefire-cyan:#00ffff;--blazefire-magenta:#ff00ff}`;
  document.head.appendChild(style);
}

export function createBlazefireLogo(size: number = 40): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 40 40" fill="none"><path d="M20 3C20 3 30 14 30 23C30 28 25.5 32 20 32C14.5 32 10 28 10 23C10 14 20 3 20 3Z" fill="#ff8800"/></svg>`;
}

export function createCompiler(options: CompilerOptions = {}): CompilerInstance {
  const defaultOptions: CompilerOptions = {
    jsc: { parser: { syntax: 'typescript', tsx: true }, transform: { react: { runtime: 'automatic' } } },
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

const Blazefire = {
  version: BLAZEFIRE_VERSION,
  createCompiler,
  insertBlazefireStyles,
  createBlazefireLogo,
};

export default Blazefire;
