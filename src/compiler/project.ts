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
  NapiEventCallback,
  NapiEventResult,
  NapiEntrypoints,
  NapiProjectOptions,
  NapiTurboEngineOptions,
  NapiUpdateMessage,
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
import { shouldForwardIssues, stripDiscardedIssues, type IssueBearingPayload, type IssuePolicy } from './issues.js'
import { FROSTFAST_VERSION } from '../version.js'

/** CI is commonly `CI=1`/`CI=true`; treat any non-falsey value as CI. */
function isCiEnv(): boolean {
  const v = process.env.CI
  if (v === undefined || v === '') return false
  return !/^(false|0|no)$/i.test(v.trim())
}

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

export function getRouteNames(entrypoints: NapiEntrypoints): string[] {
  return Array.from(entrypoints.routes.keys())
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
      isCi: isCiEnv(),
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
    const next = snapshot({
      ...this.#last.parsed,
      env: update.env ?? this.#last.parsed.env,
      defineEnv: update.defineEnv ?? this.#last.parsed.defineEnv,
      nextConfig: update.nextConfig ?? this.#last.parsed.nextConfig,
      rootPath: update.rootPath ?? this.#last.parsed.rootPath,
      projectPath: update.projectPath ?? this.#last.parsed.projectPath,
    })

    const partial: PartialProjectOptions = {}

    // The WHOLE partial — including rootPath/projectPath — is hash-gated, so
    // passing an UNCHANGED path never forces a native update (spec H-08).
    if (this.#gate.changed(next)) {
      partial.nextConfig = next.json
      partial.rootPath = next.parsed.rootPath
      partial.projectPath = next.parsed.projectPath
      if (update.env) partial.env = rustifyEnv(update.env)
      if (update.defineEnv) {
        partial.defineEnv = Object.values(update.defineEnv).flat()
      }
    }

    if (Object.keys(partial).length === 0) return false
    await this.#binding.projectUpdate(this.handle, partial)
    this.#last = next
    this.#gate.remember(next)
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
  entrypointEvents(signal?: AbortSignal): AsyncIterable<NapiEntrypoints> {
    return this.#stream(
      (callback) => this.#binding.projectEntrypointsSubscribe(this.handle, callback),
      (payload) => {
        const result = stripDiscardedIssues(
          payload as NapiEventResult<NapiEntrypoints | null>,
          this.issuePolicy
        )
        if (result.value && result.value.routes instanceof Map) return result.value
        if (
          result.value === null ||
          (typeof result.value === 'object' &&
            result.value !== null &&
            Object.keys(result.value).length === 0)
        ) {
          return { routes: new Map() }
        }
        throw new Error('Frostfast entrypoint subscription returned an invalid payload')
      },
      signal
    )
  }

  /** Build-status ticks; aggregationMs bounds the chatter (spec H-10). */
  updateInfoEvents(
    aggregationMs = 30,
    signal?: AbortSignal
  ): AsyncIterable<{ type: 'start' | 'end'; value?: unknown }> {
    return this.#stream(
      (callback) =>
        this.#binding.projectUpdateInfoSubscribe(this.handle, aggregationMs, callback),
      (payload) => {
        const message = payload as NapiUpdateMessage
        if (message.updateType !== 'start' && message.updateType !== 'end') {
          throw new Error(`Frostfast emitted an unknown update type: ${message.updateType}`)
        }
        return { type: message.updateType, value: message.value }
      },
      signal
    )
  }

  /**
   * Per-chunk client HMR updates. With the default 'suppress' policy the
   * includeIssues gate tells Rust NOT to marshal discarded issues at all
   * (spec H-09) — the v1 waste never crosses the boundary.
   */
  hmrEvents(
    chunkName: string,
    target: HmrTarget = HmrTarget.Client,
    signal?: AbortSignal
  ): AsyncIterable<unknown> {
    return this.#stream(
      (callback) =>
        this.#binding.projectHmrEvents(
          this.handle,
          chunkName,
          target,
          shouldForwardIssues(this.issuePolicy),
          callback
        ),
      (payload) => stripDiscardedIssues(payload as object, this.issuePolicy),
      signal
    )
  }

  /** Server-target HMR (fast refresh / restart instructions). */
  serverHmrEvents(signal?: AbortSignal): AsyncIterable<unknown> {
    return this.#stream(
      (callback) => this.#binding.projectAllHmrEvents(this.handle, HmrTarget.Server, callback),
      undefined,
      signal
    )
  }

  async *#stream<T>(
    subscribe: (callback: NapiEventCallback<unknown>) => RootTaskHandle,
    map: (payload: unknown) => T = (p) => p as T,
    signal?: AbortSignal
  ): AsyncGenerator<T, void, undefined> {
    const queue: StreamEvent[] = []
    let waiting:
      | {
          resolve: (event: StreamEvent | typeof STREAM_ABORTED) => void
        }
      | undefined
    let closed = false
    const callback: NapiEventCallback<unknown> = (error, payload) => {
      if (closed) return
      const event = { error, payload }
      if (waiting) {
        const current = waiting
        waiting = undefined
        current.resolve(event)
      } else {
        queue.push(event)
      }
    }

    const task = subscribe(callback)
    try {
      while (true) {
        if (signal?.aborted) break
        const event =
          queue.length > 0
            ? queue.shift()!
            : await waitForEvent(signal, (next) => (waiting = next))
        if (event === STREAM_ABORTED) break
        if (event.error) throw event.error
        yield map(event.payload)
      }
    } finally {
      closed = true
      waiting = undefined
      this.#binding.rootTaskDispose(task)
    }
  }
}

const STREAM_ABORTED: unique symbol = Symbol('frostfast.stream-aborted')
type StreamEvent = { error: Error | null; payload: unknown }

function waitForEvent(
  signal: AbortSignal | undefined,
  setWaiting: (
    waiting:
      | {
          resolve: (event: StreamEvent | typeof STREAM_ABORTED) => void
        }
      | undefined
  ) => void
): Promise<StreamEvent | typeof STREAM_ABORTED> {
  return new Promise((resolve) => {
    const onAbort = (): void => {
      signal?.removeEventListener('abort', onAbort)
      setWaiting(undefined)
      resolve(STREAM_ABORTED)
    }
    setWaiting({
      resolve: (payload) => {
        signal?.removeEventListener('abort', onAbort)
        resolve(payload)
      },
    })
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
  })
}
