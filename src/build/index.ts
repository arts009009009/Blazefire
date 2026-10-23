/**
 * frostfastBuild — the production build orchestrator (Turbopack-only).
 *
 * One pass, straight into the Rust graph (mandate 3):
 *   compact config -> createProject(watch:false) -> writeAllEntrypointsToDisk
 *   -> consume manifests -> await shutdown (flushes the persistent cache).
 *
 * v1's build ran inside a forked worker with a module-level shutdownPromise
 * that was never assigned (dead code, spec H-18). v2 awaits shutdown in a
 * finally — the graph cache is always flushed before the process moves on.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadFrostfastBinding } from '../compiler/bindings.js'
import { FrostfastProject } from '../compiler/project.js'
import { rustifyEnv } from '../config/serialize.js'
import type { RustifiedEnvVar } from '../config/serialize.js'
import { BLAZEFIRE_VERSION } from '../version.js'

export interface BuildInput {
  dir: string
  distDir?: string
  buildId?: string
  nextConfig?: Record<string, unknown>
  env?: Record<string, string | undefined>
  defineEnv?: Record<string, RustifiedEnvVar[]>
  appDirOnly?: boolean
}

export interface BuildResult {
  distDir: string
  routes: string[]
  durationMs: number
}

export async function frostfastBuild(input: BuildInput): Promise<BuildResult> {
  const started = Date.now()
  const distDir = input.distDir ?? join(input.dir, '.blazefire')
  const buildId = input.buildId ?? BLAZEFIRE_VERSION
  const env = input.env ?? {}

  const binding = await loadFrostfastBinding()
  const project = await FrostfastProject.create({
    binding,
    rootPath: input.dir,
    projectPath: input.dir,
    distDir,
    dev: false,
    buildId,
    env,
    defineEnv: input.defineEnv ?? {},
    nextConfig: input.nextConfig ?? {},
    // Build sessions are short: skip compaction, let Rust flush on shutdown.
    isPersistentCachingEnabled: true,
  })

  try {
    // Rust writes every output file; JS only consumes manifests (v1 truth,
    // preserved — this is where the framework stays out of the hot path).
    await mkdir(distDir, { recursive: true })
    await writeFile(join(distDir, 'turbopack'), '', 'utf8')
    await writeFile(
      join(distDir, 'package.json'),
      JSON.stringify({ type: 'commonjs' }),
      'utf8'
    )

    await project.writeAllEntrypointsToDisk(input.appDirOnly ?? true)

    const entrypoints = await project.entrypoints()
    const routes = Object.keys(entrypoints.routes ?? {})

    return { distDir, routes, durationMs: Date.now() - started }
  } finally {
    // Always flush + release the graph, even on failure.
    await project.shutdown()
  }
}

export { rustifyEnv }
