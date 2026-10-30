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

import { dirname, isAbsolute, join, relative } from 'node:path'
import { PACKAGE_ROOT } from '../package-root.js'

export const INJECT_MARKER = '/* blazefire-injected */'

export interface LoaderContextLike {
  resourcePath: string
  /** webpack/turbopack async result channel (present in a real loader context). */
  callback?: (error: Error | null, code?: string, map?: string) => void
}

/** Absolute path of the compiled client runtime entry. */
export function runtimeEntryPath(): string {
  return join(PACKAGE_ROOT, 'dist', 'runtime', 'inject.js')
}

/**
 * Prepend a side-effect import of the client runtime to the matched source.
 *
 * When an input source map is present we shift it down one generated line via
 * the async callback, so stack traces in the host bootstrap stay accurate.
 */
export function blazefireLoader(
  this: LoaderContextLike,
  source: string,
  // webpack/turbopack hand the input map as an OBJECT (loader API) or a
  // STRING depending on the stage; both shapes reach us in practice.
  map?: string | object
): string | void {
  if (source.includes(INJECT_MARKER)) return source

  const inject = relative(dirname(this.resourcePath), runtimeEntryPath())
  // Normalize to POSIX separators for module specifiers on Windows.
  let specifier = inject.split('\\').join('/')
  // A bare relative specifier ('pkg/dist/…') needs an explicit './' or it is
  // treated as a package import. A cross-drive relative() on Windows is
  // already absolute and stays absolute — the one case that cannot be relativized.
  if (!specifier.startsWith('.') && !isAbsolute(specifier)) specifier = `./${specifier}`

  const code = `import ${JSON.stringify(specifier)}; ${INJECT_MARKER}\n${source}`

  if (map && typeof this.callback === 'function') {
    this.callback(null, code, shiftMapDownOneLine(map))
    return
  }
  return code
}

/** Nudge a source-map v3 `mappings` field down by one generated line. */
function shiftMapDownOneLine(map: string): string {
  try {
    const parsed = JSON.parse(map) as { mappings?: unknown }
    if (typeof parsed.mappings === 'string') parsed.mappings = `;${parsed.mappings}`
    return JSON.stringify(parsed)
  } catch {
    return map
  }
}

export default blazefireLoader
