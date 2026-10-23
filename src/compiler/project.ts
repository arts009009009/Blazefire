/**
 * FrostfastProject — the typed wrapper around one native project handle.
 *
 * Responsibilities (and nothing more — no wrapper cruft, mandate 3):
 *  - construct the native project with compact, hash-keyed config (H-08)
 *  - expose the incremental graph's event streams as AsyncIterables that
 *    ALWAYS dispose their RootTask (v1 required manual disposal in every
 *    consumer's finally; here it cannot be forgotten)
 *  - strip discarded issues before any JS consumer sees them (H-09)
 */

import type {
  FrostfastBinding,
  NapiEntrypoints,
  NapiProjectOptions,
  NapiTurboEngineOptions,
  PartialProjectOptions,
  ProjectHandle,
  RootTaskHandle,
} from './native-contract.js'
import { HmrTarget } from './native-contract.js'
import {
  ConfigChangeGate,
  rustifyEnv,
  serializeProjectConfig,
  type RustifiedEnvVar,
  type SerializedProjectConfig,
} from '../config/serialize.js'
import { shouldForwardIssues, stripDiscardedIssues, type IssuePolicy } from './issues.js'
import { FROSTFAST_VERSION } from '../version.js'

export interface CreateProjectInput {
  binding: FrostfastBinding
  rootPath: string
  projectPath: string
  distDir: string
  dev: boolean
  buildId: string
  env: Record<string, string | undefined>
  defineEnv: Record<string, RustifiedEnvVar[]>
  nextConfig: Record<string, unknown>
  encryptionKey?: string
  isPersistentCachingEnabled?: boolean
  serverHmr?: boolean
  /** v2 default: discarded issues are never marshalled (spec H-09). */
  issuePolicy?: IssuePolicy
  watch?: { enable: boolean; pollIntervalMs?: number }
}

export interface ProjectUpdate {
  rootPath?: string
  projectPath?: string
  env?: Record<string, string | undefined>
  defineEnv?: Record<string, RustifiedEnvVar[]>
  nextConfig?: Record<string, unknown>
}

/** The normalized shape of the last config snapshot, kept parsed for gating. */
interface NormalizedSnapshot extends SerializedProjectConfig {
  parsed: {
    rootPath: string
    projectPath: string
    distDir: string
    dev: boolean
    buildId: string
    env: Record<string, string | undefined>
    defineEnv: Record<string, RustifiedEnvVar[]>
    nextConfig: Record<string, unknown>
  }
}

function snapshot(input: {
  rootPath: string
  projectPath: string
  distDir: string
  dev: boolean
  buildId: string
  env: Record<string, string | undefined>
  defineEnv: Record<string, RustifiedEnvVar[]>
  nextConfig: Record<string, unknown>
}): NormalizedSnapshot {
  const serialized = serializeProjectConfig(input)
  return { ...serialized, parsed: input }
}

export class FrostfastProject {
  readonly handle: ProjectHandle
  readonly issuePolicy: IssuePolicy
  readonly #binding: FrostfastBinding
  readonly #gate = new ConfigChangeGate()
  #last: NormalizedSnapshot
  #stopped = false

  private constructor(
    binding: FrostfastBinding,
    handle: ProjectHandle,
    issuePolicy: IssuePolicy,
    last: NormalizedSnapshot
  ) {
    this.#binding = binding
    this.handle = handle
    this.issuePolicy = issuePolicy
    this.#last = last
    this.#gate.remember(last)
  }

  static async create(input: CreateProjectInput): Promise<FrostfastProject> {
    const last = snapshot({
      rootPath: input.rootPath,
      projectPath: input.projectPath,
      distDir: input.distDir,
      dev: input.dev,
      buildId: input.buildId,
      env: input.env,
      defineEnv: input.defineEnv,
      nextConfig: input.nextConfig,
    })

    const engineOptions: NapiTurboEngineOptions = {
      isCi: process.env.CI === 'true',
      // Short sessions skip compaction; dev sessions stay resident.
      isShortSession: !input.dev,
      turbopackMemoryEviction: 'auto',
    }

    const projectOptions: NapiProjectOptions = {
      rootPath: input.rootPath,
      projectPath: input.projectPath,
      distDir: input.distDir,
      watch: input.watch ?? { enable: input.dev },
      nextConfig: last.json,
      env: rustifyEnv(input.env),
      defineEnv: Object.values(input.defineEnv).flat(),
      dev: input.dev,
      encryptionKey: input.encryptionKey ?? '',
      buildId: input.buildId,
      noMangling: false,
      isPersistentCachingEnabled: input.isPersistentCachingEnabled ?? input.dev,
      // The persistent graph cache is keyed on the COMPILER version that
      // wrote it — injected for real (v1's __NEXT_VERSION was never set).
      nextVersion: FROSTFAST_VERSION,
      serverHmr: input.serverHmr ?? false,
    }

    const handle = await input.binding.projectNew(projectOptions, engineOptions, {
      throwTurbopackInternalError: (error) => {
        throw new Error(`Frostfast internal error: ${error.message}`)
      },
    })

    return new FrostfastProject(
      input.binding,
      handle,
      input.issuePolicy ?? 'suppress',
      last
    )
  }

  /**
   * Push a partial update into the Rust graph. The config half is
   * hash-gated: when nothing observable changed, the marshalling and the
   * napi call are BOTH skipped (spec H-08).
   *
   * @returns true when a native update was issued, false when skipped.
   */
  async update(update: ProjectUpdate): Promise<boolean> {
    const partial: PartialProjectOptions = {}

    if (update.rootPath !== undefined) partial.rootPath = update.rootPath
    if (update.projectPath !== undefined) partial.projectPath = update.projectPath

    if (update.env || update.defineEnv || update.nextConfig) {
      const next = snapshot({
        ...this.#last.parsed,
        env: update.env ?? this.#last.parsed.env,
        defineEnv: update.defineEnv ?? this.#last.parsed.defineEnv,
        nextConfig: update.nextConfig ?? this.#last.parsed.nextConfig,
        rootPath: update.rootPath ?? this.#last.parsed.rootPath,
        projectPath: update.projectPath ?? this.#last.parsed.projectPath,
      })

      if (this.#gate.changed(next)) {
        partial.nextConfig = next.json
        if (update.env) partial.env = rustifyEnv(update.env)
        if (update.defineEnv) {
          partial.defineEnv = Object.values(update.defineEnv).flat()
        }
        this.#last = next
        this.#gate.remember(next)
      }
    }

    if (Object.keys(partial).length === 0) return false
    await this.#binding.projectUpdate(this.handle, partial)
    return true
  }

  async entrypoints(): Promise<NapiEntrypoints> {
    return this.#binding.projectEntrypoints(this.handle)
  }

  async writeAllEntrypointsToDisk(appDirOnly = true): Promise<void> {
    return this.#binding.projectWriteAllEntrypointsToDisk(this.handle, appDirOnly)
  }

  async sourceMapFor(file: string): Promise<string | undefined> {
    return this.#binding.projectGetSourceMap(this.handle, file)
  }

  async invalidateFileSystemCache(): Promise<void> {
    return this.#binding.projectInvalidateFileSystemCache(this.handle)
  }

  /** Flush the Rust-side graph state and release the handle. Idempotent. */
  async shutdown(): Promise<void> {
    if (this.#stopped) return
    this.#stopped = true
    await this.#binding.projectShutdown(this.handle)
  }

  async onExit(): Promise<void> {
    await this.#binding.projectOnExit(this.handle)
  }

  // -------------------------------------------------------------------------
  // Event streams: AsyncIterables that dispose their RootTask unconditionally.
  // -------------------------------------------------------------------------

  /** Route-graph changes. */
  entrypointEvents(): AsyncIterable<NapiEntrypoints> {
    return this.#stream(
      () => this.#binding.projectEntrypointsSubscribe(this.handle),
      (payload) =>
        stripDiscardedIssues(payload as object, this.issuePolicy) as unknown as NapiEntrypoints
    )
  }

  /** Build-status ticks; aggregationMs bounds the chatter (spec H-10). */
  updateInfoEvents(
    aggregationMs = 30
  ): AsyncIterable<{ type: 'start' | 'end'; value?: unknown }> {
    return this.#stream(() =>
      this.#binding.projectUpdateInfoSubscribe(this.handle, aggregationMs)
    )
  }

  /**
   * Per-chunk client HMR updates. With the default 'suppress' policy the
   * includeIssues gate tells Rust NOT to marshal discarded issues at all
   * (spec H-09) — the v1 waste never crosses the boundary.
   */
  hmrEvents(chunkName: string, target: HmrTarget = HmrTarget.Client): AsyncIterable<unknown> {
    return this.#stream(
      () =>
        this.#binding.projectHmrEvents(
          this.handle,
          chunkName,
          target,
          shouldForwardIssues(this.issuePolicy)
        ),
      (payload) => stripDiscardedIssues(payload as object, this.issuePolicy)
    )
  }

  /** Server-target HMR (fast refresh / restart instructions). */
  serverHmrEvents(): AsyncIterable<unknown> {
    return this.#stream(() =>
      this.#binding.projectAllHmrEvents(this.handle, HmrTarget.Server)
    )
  }

  async *#stream<T>(
    subscribe: () => Promise<RootTaskHandle>,
    map: (payload: unknown) => T = (p) => p as T
  ): AsyncGenerator<T, void, undefined> {
    const task = await subscribe()
    try {
      // Each iteration awaits the next native task message; consumers that
      // break/return/throw hit the finally and the RootTask is disposed.
      while (true) {
        const payload = await recvNextTaskMessage(task)
        if (payload === END_OF_STREAM) break
        yield map(payload)
      }
    } finally {
      this.#binding.rootTaskDispose(task)
    }
  }
}

// ---------------------------------------------------------------------------
// Task-message pump. In a full build these are the registered
// recv/sendTaskMessage worker-channel exports; isolated behind one seam so
// the pump contract is explicit and swappable (tests install a stub).
// ---------------------------------------------------------------------------

export const END_OF_STREAM: unique symbol = Symbol('frostfast.end-of-stream')

export type TaskMessagePump = (task: RootTaskHandle) => Promise<unknown>

let taskPump: TaskMessagePump = () =>
  Promise.reject(new Error('No Frostfast task-message pump installed'))

export function installTaskMessagePump(pump: TaskMessagePump): void {
  taskPump = pump
}

function recvNextTaskMessage(task: RootTaskHandle): Promise<unknown> {
  return taskPump(task)
}
