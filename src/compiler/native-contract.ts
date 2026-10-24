/**
 * Frostfast native contract — the TypeScript IDL for the binary napi
 * boundary (mandate 3: pure Rust/TS integration).
 *
 * This is v2's counterpart to v1's generated-native.d.ts, but owned here as
 * a MINIMAL, EXPLICIT surface: only the symbols the framework runtime
 * actually calls, each annotated with its calling convention. v1 carried 54
 * symbols plus three full HMR pipelines; v2 binds what it consumes and
 * nothing else.
 *
 * Calling conventions preserved from the v1 boundary:
 *  - nextConfig crosses as ONE compact JSON string (see config/serialize.ts)
 *  - env / defineEnv cross as flat [{name, value}] tuples
 *  - RegExp values are decomposed ({type:'regex', value:{source,flags}})
 *  - Project/Endpoint/RootTask/Lockfile are OPAQUE handles: JS only passes
 *    them back, never inspects them
 *  - event streams return a RootTask handle consumed via task messages and
 *    MUST be disposed with rootTaskDispose in the consumer's finally block
 */

export type NapiOpaqueType = 'Project' | 'Endpoint' | 'RootTask' | 'Lockfile'

export interface NapiHandle<T extends NapiOpaqueType> {
  __napiType: T
}

export type ProjectHandle = NapiHandle<'Project'>
export type EndpointHandle = NapiHandle<'Endpoint'>
export type RootTaskHandle = NapiHandle<'RootTask'>
export type LockfileHandle = NapiHandle<'Lockfile'>

export interface NapiEnvVar {
  name: string
  value: string | undefined
}

export interface NapiProjectOptions {
  rootPath: string
  projectPath: string
  distDir: string
  watch: { enable: boolean; pollIntervalMs?: number }
  /** ONE compact JSON string — produced by serializeProjectConfig(). */
  nextConfig: string
  env: NapiEnvVar[]
  defineEnv: NapiEnvVar[]
  dev: boolean
  encryptionKey: string
  buildId: string
  browserslistQuery?: string
  noMangling: boolean
  isPersistentCachingEnabled: boolean
  nextVersion: string
  serverHmr?: boolean
}

export interface NapiTurboEngineOptions {
  isCi?: boolean
  isShortSession?: boolean
  skipCompaction?: boolean
  /** Required: Rust-side memory eviction mode. */
  turbopackMemoryEviction: 'off' | 'auto' | 'full'
}

export type PartialProjectOptions = Partial<
  Pick<NapiProjectOptions, 'rootPath' | 'projectPath' | 'nextConfig' | 'env' | 'defineEnv' | 'watch'>
>

export enum HmrTarget {
  Client = 'client',
  Server = 'server',
}

export type RouteKind = 'page' | 'page-api' | 'app-page' | 'app-route' | 'conflict'

export interface Route {
  type: RouteKind
  [key: string]: unknown
}

export interface NapiEntrypoints {
  routes: Map<string, Route>
  [key: string]: unknown
}

export interface NapiEventResult<T> {
  value: T
  issues?: unknown
}

export interface NapiUpdateMessage {
  updateType: string
  value?: unknown
}

export type NapiEventCallback<T> = (error: Error | null, value: T) => void

export interface CompilationIssue {
  severity?: string
  message: string
  [key: string]: unknown
}

/**
 * The subset of the Frostfast napi surface this runtime binds. Every method
 * maps 1:1 to a native export — there is no wrapper cruft between this
 * interface and the .node binary.
 */
export interface FrostfastBinding {
  // ---- project graph ----
  projectNew(
    options: NapiProjectOptions,
    engine: NapiTurboEngineOptions,
    callbacks?: {
      throwTurbopackInternalError: (error: { message: string }) => void
    }
  ): Promise<ProjectHandle>
  projectUpdate(handle: ProjectHandle, options: PartialProjectOptions): Promise<void>
  projectEntrypoints(handle: ProjectHandle): Promise<NapiEntrypoints>
  projectEntrypointsSubscribe(
    handle: ProjectHandle,
    callback: NapiEventCallback<NapiEventResult<NapiEntrypoints | null>>
  ): RootTaskHandle
  projectAllHmrEvents(
    handle: ProjectHandle,
    target: HmrTarget,
    callback: NapiEventCallback<unknown>
  ): RootTaskHandle
  projectHmrEvents(
    handle: ProjectHandle,
    chunkName: string,
    target: HmrTarget,
    /** v2 marshalling gate (spec H-09): when false Rust never ships issues. */
    includeIssues: boolean,
    callback: NapiEventCallback<unknown>
  ): RootTaskHandle
  projectUpdateInfoSubscribe(
    handle: ProjectHandle,
    aggregationMs: number,
    callback: NapiEventCallback<NapiUpdateMessage>
  ): RootTaskHandle
  projectCompilationEventsSubscribe(
    handle: ProjectHandle,
    callback: NapiEventCallback<unknown>,
    eventTypes?: string[]
  ): void
  projectWriteAllEntrypointsToDisk(handle: ProjectHandle, appDirOnly?: boolean): Promise<void>
  projectGetSourceMap(handle: ProjectHandle, file: string): Promise<string | undefined>
  projectTraceSource(
    handle: ProjectHandle,
    frame: { file: string; line?: number; column?: number },
    cwd: string
  ): Promise<unknown>
  projectFeatureUsage(handle: ProjectHandle): Promise<unknown>
  projectInvalidateFileSystemCache(handle: ProjectHandle): Promise<void>
  projectShutdown(handle: ProjectHandle): Promise<void>
  projectOnExit(handle: ProjectHandle): Promise<void>

  // ---- endpoints ----
  endpointWriteToDisk(endpoint: EndpointHandle): Promise<void>

  // ---- event-stream lifecycle ----
  /** Streams hand back a RootTask; disposal is mandatory (see project.ts). */
  rootTaskDispose(task: RootTaskHandle): void

  // ---- transform ----
  transform(
    source: string | Buffer,
    isModule: boolean,
    /** Buffer.from(JSON.stringify(options)) — the v1 convention, kept. */
    options: Buffer
  ): Promise<{ code: string; map?: string }>
  transformSync(
    source: string | Buffer,
    isModule: boolean,
    options: Buffer
  ): { code: string; map?: string }

  // ---- lockfile (dev single-instance) ----
  lockfileTryAcquireSync(path: string): LockfileHandle | null
  lockfileUnlockSync(handle: LockfileHandle): void

  // ---- rust-scheduled JS worker threads ----
  registerWorkerScheduler(
    create: (creation: { options: { filename: string; cwd: string } }) => number,
    terminate: (termination: { id: number }) => void
  ): void

  // ---- misc ----
  getTargetTriple(): string
  turbopackDatabaseCompact(path: string, version: string): Promise<void>

  /** Frozen at build time by the Frostfast pipeline; used for the version check. */
  readonly FROSTFAST_VERSION?: string
}
