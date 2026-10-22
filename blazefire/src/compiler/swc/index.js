import { createRequire } from 'node:module'
import path from 'node:path'

function loadNextSwc() {
  // `createRequire` from the current project walks up through every parent
  // `node_modules`, so this finds a hoisted or nested `next` in both single
  // projects and monorepos.
  const requireFromProject = createRequire(
    path.join(process.cwd(), 'package.json')
  )

  try {
    return requireFromProject('next/dist/build/swc')
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      error.code === 'MODULE_NOT_FOUND' &&
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

export function createSwcBindings(resolveBackend = loadNextSwc) {
  return {
    transformSync(code, options) {
      const backend = resolveBackend()
      if (typeof backend.transformSync !== 'function') {
        throw new Error(
          'The installed Next.js SWC backend has no transformSync API.'
        )
      }
      return backend.transformSync(code, options)
    },
    async transform(code, options) {
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
