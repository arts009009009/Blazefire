/**
 * Blazefire Framework - Error Overlay & DevTools
 * Powered by Frostfast compiler
 */

export { BlazefireLogo } from './components/blazefire-logo';
export { BlazefireErrorHeader, BlazefireErrorOverlay } from './components/error-overlay-layout';
export { BlazefireDevToolsIndicator } from './components/blazefire-logo';
export { insertBlazefireStyles, blazefireStyles } from './styles';

// Compiler exports
export {
  createCompiler,
  FROSTFAST_VERSION,
  defaultCompilerOptions
} from './compiler';
export type { CompilerResult } from './compiler';

export const version = '1.0.0';
