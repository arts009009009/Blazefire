/**
 * createCompiler — the Frostfast compiler facade.
 *
 * Direct binary napi contract (mandate 3): transform() crosses as
 * (source, isModule, Buffer.from(JSON.stringify(options))) exactly as the
 * native export declares it. There is no `next/dist/build/swc` indirection
 * and no lazy CJS re-require shim — v1's adapter existed only because the
 * vendored fork could not build (spec H-19); v2 binds Frostfast itself.
 */

import { loadFrostfastBinding, loadFrostfastBindingSync } from './bindings.js'
import type { FrostfastBinding } from './native-contract.js'
import { FrostfastProject, type CreateProjectInput } from './project.js'
import { FROSTFAST_VERSION } from '../version.js'

export interface TransformOptions {
  filename?: string
  jsc?: {
    target?: string
    parser?: { syntax: string; tsx?: boolean; jsx?: boolean; decorators?: boolean }
    transform?: { react?: { runtime?: string } }
  }
  module?: { type?: string }
  [key: string]: unknown
}

export interface TransformResult {
  code: string
  map?: string
}

export interface CompilerInstance {
  version: string
  transform(code: string, options?: TransformOptions): Promise<TransformResult>
  transformSync(code: string, options?: TransformOptions): TransformResult
  createProject(input: Omit<CreateProjectInput, 'binding'>): Promise<FrostfastProject>
}

/** JSON options cross as a Buffer — the native signature requires it. */
function optionsBuffer(options: TransformOptions = {}): Buffer {
  return Buffer.from(JSON.stringify(options))
}

export function createCompiler(binding?: FrostfastBinding): CompilerInstance {
  let resolved = binding

  const get = async (): Promise<FrostfastBinding> => {
    resolved ??= await loadFrostfastBinding()
    return resolved
  }

  return {
    version: FROSTFAST_VERSION,

    async transform(code, options) {
      const b = await get()
      return b.transform(code, isModuleSource(code, options), optionsBuffer(options))
    },

    transformSync(code, options) {
      // Sync path is native-only by contract: it never triggers a load.
      const b = resolved ?? loadFrostfastBindingSync()
      return b.transformSync(code, isModuleSource(code, options), optionsBuffer(options))
    },

    async createProject(input) {
      const b = await get()
      return FrostfastProject.create({ ...input, binding: b })
    },
  }
}

function isModuleSource(code: string, options?: TransformOptions): boolean {
  if (options?.jsc?.parser?.syntax === 'typescript') return true
  if (options?.module?.type) return true
  // Heuristics kept minimal: the native side parses when unsure.
  return /^\s*(import|export)\s/m.test(code)
}

export { loadFrostfastBinding, loadFrostfastBindingSync }
export * from './native-contract.js'
export * from './issues.js'
export { FrostfastProject } from './project.js'
export type { CreateProjectInput, ProjectUpdate } from './project.js'
