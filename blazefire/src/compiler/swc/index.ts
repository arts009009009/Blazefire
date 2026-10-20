declare const process: { cwd(): string }

declare function require(id: 'module'): {
  createRequire(filename: string): (specifier: string) => NextSwcBackend
}
declare function require(id: 'path'): {
  join(...parts: string[]): string
}

export interface SwcOptions {
  filename?: string
  jsc?: {
    target?: string
    parser?: {
      syntax: string
      tsx?: boolean
      jsx?: boolean
      decorators?: boolean
    }
    transform?: { react?: { runtime?: string } }
  }
  module?: { type?: string }
  [key: string]: unknown
}

export interface SwcResult {
  code: string
  map?: string
}

interface NextSwcBackend {
  loadBindings?: () => Promise<unknown>
  transformSync?: (code: string, options?: SwcOptions) => SwcResult
  transform?: (code: string, options?: SwcOptions) => Promise<SwcResult>
}

function loadNextSwc(): NextSwcBackend {
  const requireFromProject = require('module').createRequire(
    require('path').join(process.cwd(), 'package.json')
  )

  try {
    return requireFromProject('next/dist/build/swc') as NextSwcBackend
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'MODULE_NOT_FOUND' &&
      'message' in error &&
      typeof error.message === 'string' &&
      error.message.includes("'next/dist/build/swc'")
    ) {
      throw new Error(
        'Frostfast transforms require Next.js to be installed in the project.'
      )
    }
    throw error
  }
}

export function createSwcBindings(
  resolveBackend: () => NextSwcBackend = loadNextSwc
) {
  return {
    transformSync(code: string, options?: SwcOptions): SwcResult {
      const backend = resolveBackend()
      if (typeof backend.transformSync !== 'function') {
        throw new Error('The installed Next.js SWC backend has no transformSync API.')
      }
      return backend.transformSync(code, options)
    },
    async transform(code: string, options?: SwcOptions): Promise<SwcResult> {
      const backend = resolveBackend()
      if (typeof backend.loadBindings === 'function') {
        await backend.loadBindings()
      }
      if (typeof backend.transform !== 'function') {
        throw new Error('The installed Next.js SWC backend has no transform API.')
      }
      return backend.transform(code, options)
    },
  }
}

const swc = createSwcBindings()

export const transformSync = swc.transformSync
export const transform = swc.transform
