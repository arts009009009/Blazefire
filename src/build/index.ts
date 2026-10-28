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

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { loadFrostfastBinding } from '../compiler/bindings.js'
import { FrostfastProject, getRouteNames } from '../compiler/project.js'
import { rustifyEnv } from '../config/serialize.js'
import type { RustifiedEnvVar } from '../config/serialize.js'
import { BlazefireConfigError } from '../config/types.js'

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
  const dir = resolve(input.dir)
  const configuredDistDir = input.distDir ?? '.blazefire'
  const distDir = isAbsolute(configuredDistDir)
    ? configuredDistDir
    : resolve(dir, configuredDistDir)
  // cleanDistDir() recursively deletes the whole dist dir, so a distDir that
  // IS or CONTAINS the project root would wipe the source tree (one typo like
  // `distDir: '.'` away from `rm -rf <project>`). Out-of-tree dirs are fine;
  // anything that swallows the project is refused before a single rm.
  const insideProject = relative(distDir, dir)
  if (insideProject === '' || (!insideProject.startsWith('..') && !isAbsolute(insideProject))) {
    throw new BlazefireConfigError(
      `distDir (${configuredDistDir}) resolves to ${distDir}, which is the project root or one of its parents — refusing to clean it. Choose a dedicated output directory inside the project (default: .blazefire).`
    )
  }
  // Unique per build so successive builds are distinguishable (deployment
  // ID / cache keys). A version-derived default made every build identical.
  const buildId = input.buildId ?? randomUUID()
  const env = input.env ?? {}

  const binding = await loadFrostfastBinding()
  const project = await FrostfastProject.create({
    binding,
    rootPath: dir,
    projectPath: dir,
    distDir,
    dev: false,
    buildId,
    env,
    defineEnv: input.defineEnv ?? {},
    nextConfig: input.nextConfig ?? {},
    // Build sessions are short: skip compaction, let Rust flush on shutdown.
    isPersistentCachingEnabled: true,
  })

  let buildError: unknown
  try {
    // Rust writes every output file; JS only consumes manifests (v1 truth,
    // preserved — this is where the framework stays out of the hot path).
    await cleanDistDir(distDir)
    await mkdir(distDir, { recursive: true })
    await writeFile(join(distDir, 'turbopack'), '', 'utf8')
    await writeFile(
      join(distDir, 'package.json'),
      JSON.stringify({ type: 'commonjs' }),
      'utf8'
    )

    await project.writeAllEntrypointsToDisk(input.appDirOnly ?? true)

    const entrypoints = await project.entrypoints()
    const routes = getRouteNames(entrypoints)

    return { distDir, routes, durationMs: Date.now() - started }
  } catch (error) {
    buildError = error
    throw error
  } finally {
    // Always flush + release the graph, even on failure — but never let a
    // shutdown error mask the REAL build error that got us here.
    try {
      await project.shutdown()
    } catch (shutdownError) {
      if (!buildError) throw shutdownError
    }
  }
}

/**
 * Remove stale output from previous builds so a deleted/renamed route cannot
 * survive into a deploy. Preserves the conventional `cache/` directory that
 * holds the persistent graph cache.
 */
async function cleanDistDir(distDir: string): Promise<void> {
  let entries: string[] = []
  try {
    entries = await readdir(distDir)
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return // nothing to clean yet
    }
    throw error
  }
  for (const entry of entries) {
    if (entry === 'cache') continue
    await rm(join(distDir, entry), { recursive: true, force: true })
  }
}

export { rustifyEnv }
