/**
 * Turbopack injection loader — the ONLY injection vector in v2.
 *
 * v1 needed both a webpack entry-prepend hook AND a turbopack.rules loader
 * (spec H-01). v2 is Turbopack-only, so this loader is the whole story:
 * it prepends a side-effect import of the client runtime to the host
 * framework's client bootstrap, ahead of application code.
 *
 * The import path is made RELATIVE to the matched resource because
 * Turbopack rejects absolute module paths outside the project root (v1
 * learned this the hard way). Idempotent via an inline marker, so a module
 * matched by two rules is not double-injected.
 */

import { dirname, relative, resolve } from 'node:path'

export const INJECT_MARKER = '/* blazefire-injected */'

export interface LoaderContextLike {
  resourcePath: string
}

/** Absolute path of the compiled client runtime entry. */
export function runtimeEntryPath(loaderPath: string): string {
  // loaderPath .../dist/runtime/turbopack-loader.js -> .../dist/runtime/inject.js
  return resolve(dirname(loaderPath), 'inject.js')
}

export default function blazefireLoader(
  this: LoaderContextLike,
  source: string
): string {
  if (source.includes(INJECT_MARKER)) return source

  const inject = relative(dirname(this.resourcePath), runtimeEntryPath(this.resourcePath))
  // Normalize to POSIX separators for module specifiers on Windows.
  const specifier = inject.split('\\').join('/')

  return `import ${JSON.stringify(specifier)}; ${INJECT_MARKER}\n${source}`
}
