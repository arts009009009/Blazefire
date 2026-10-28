/**
 * createHotReloader — the single dev pipeline (spec H-02: one, not three).
 *
 * Driven entirely by the Frostfast incremental graph's event streams:
 *  - entrypoints stream  -> route add/remove messages
 *  - updateInfo stream   -> building/built status
 *  - hmr streams         -> update payloads forwarded to subscribed clients
 *
 * No polling loops. The one timer (BUILDING defer) is unref'd so it can
 * never keep the process alive (spec H-10).
 *
 * Failure model: every emission goes through safeEmit and every stream is
 * restartable — a pipeline whose answer to a transient native error (or one
 * throwing consumer) is "stop delivering HMR for the rest of the session" is
 * a pipeline that silently dies. Streams restart with a bounded backoff; a
 * stream that exhausts its retries drops its subscription entry so the next
 * subscribeClient() starts fresh instead of joining a corpse.
 */

import { getRouteNames, type FrostfastProject } from '../compiler/project.js'
import type { HmrMessage, StampedMessage } from './hmr-protocol.js'

export interface HotReloaderOptions {
  project: FrostfastProject
  emit: (message: StampedMessage) => void
  /** Report errors from detached native event-stream consumers. */
  onError?: (error: unknown) => void
  /** Defer 'building' so instant rebuilds don't flicker. */
  buildingDeferMs?: number
}

export interface HotReloader {
  /**
   * Subscribe a client to a chunk's HMR updates. A provided listener first
   * receives the on-connect delivery for THIS client — the `connected`
   * handshake, a snapshot of the current routes, and the recent replay
   * buffer — then live update payloads. Returns unsubscribe; the chunk's
   * native stream is cancelled when its last subscriber leaves.
   */
  subscribeClient(chunkName: string, listener?: (payload: unknown) => void): Promise<() => Promise<void>>
  /** Abort all stream consumption and release resources. */
  dispose(): Promise<void>
}

/** Retry budget + backoff for a stream that dies on a native error. */
const STREAM_RESTARTS = 3
const STREAM_BACKOFF_MS = 250
/** Recent messages retained for (re)connecting clients. */
const REPLAY_LIMIT = 100

/** Per-chunk subscription: the native stream lives while `refs > 0`. */
interface ChunkState {
  refs: number
  listeners: Set<(payload: unknown) => void>
  /** Cancels just this chunk's stream (dispose() aborts everything). */
  controller: AbortController
}

export async function createHotReloader(options: HotReloaderOptions): Promise<HotReloader> {
  const { project } = options
  const buildingDeferMs = options.buildingDeferMs ?? 100
  const onError =
    options.onError ??
    ((error: unknown) => console.error('[Blazefire] hot-reloader stream failed', error))
  const controller = new AbortController()
  const clientSubscriptions = new Map<string, ChunkState>()
  const streamTasks = new Set<Promise<void>>()

  // Session identity + the resume contract: every streamed message is stamped
  // with a monotonic id and kept in a bounded ring, so a client that
  // reconnects can see what it missed (protocol carries no ids itself).
  const sessionId = Date.now()
  let lastEventId = 0
  const replay: StampedMessage[] = []
  /** Current route set, snapshotted to each client on connect. */
  let currentRoutes = new Set<string>()

  const reportError = (error: unknown): void => {
    try {
      onError(error)
    } catch (callbackError) {
      console.error('[Blazefire] hot-reloader error handler failed', callbackError)
    }
  }

  /**
   * The ONLY way a message leaves this pipeline: stamped, replay-buffered,
   * and guarded. A throwing consumer (dead socket, JSON.stringify failure on
   * a circular payload) must never take a stream down with it.
   */
  const safeEmit = (message: HmrMessage): void => {
    const stamped: StampedMessage = { ...message, id: ++lastEventId }
    replay.push(stamped)
    if (replay.length > REPLAY_LIMIT) replay.shift()
    try {
      options.emit(stamped)
    } catch (error) {
      reportError(error)
    }
  }

  const track = (task: Promise<void>): void => {
    streamTasks.add(task)
    void task.then(
      () => streamTasks.delete(task),
      (error: unknown) => {
        streamTasks.delete(task)
        if (!controller.signal.aborted) reportError(error)
      }
    )
  }

  /** Sleep cut short by an abort. Resolves true when aborted. */
  const backoff = (ms: number, signal: AbortSignal): Promise<boolean> =>
    new Promise((resolve) => {
      if (signal.aborted) return resolve(true)
      const onAbort = (): void => {
        clearTimeout(timer)
        resolve(true)
      }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort)
        resolve(false)
      }, ms)
      timer.unref?.()
      signal.addEventListener('abort', onAbort, { once: true })
    })

  /**
   * Drive one native event stream, restarting after a failure with a bounded
   * backoff. A transient error used to end the loop forever ("report and
   * die"); now it costs at most STREAM_RESTARTS retries before the pipeline
   * gives up — loudly.
   */
  function runResilientStream<T>(
    name: string,
    open: () => AsyncIterable<T>,
    handle: (value: T) => void,
    onSettle?: () => void
  ): void {
    track(
      (async () => {
        let attempt = 0
        for (;;) {
          try {
            for await (const value of open()) {
              if (controller.signal.aborted) return
              handle(value)
            }
            return // stream ended cleanly
          } catch (error) {
            if (controller.signal.aborted) return
            reportError(error)
          } finally {
            onSettle?.()
          }
          attempt += 1
          if (attempt > STREAM_RESTARTS) {
            reportError(
              new Error(`[Blazefire] ${name} stream gave up after ${STREAM_RESTARTS} restarts`)
            )
            return
          }
          if (await backoff(STREAM_BACKOFF_MS * attempt, controller.signal)) return
        }
      })()
    )
  }

  // --- route graph ---------------------------------------------------------
  runResilientStream(
    'route graph',
    () => project.entrypointEvents(controller.signal),
    (entrypoints) => {
      const known = currentRoutes
      const next = new Set(getRouteNames(entrypoints))
      for (const route of next) {
        if (!known.has(route)) safeEmit({ type: 'route-added', pathname: route })
      }
      for (const route of known) {
        if (!next.has(route)) safeEmit({ type: 'route-removed', pathname: route })
      }
      currentRoutes = next
    }
  )

  // --- build status --------------------------------------------------------
  let defer: ReturnType<typeof setTimeout> | undefined
  runResilientStream(
    'build status',
    () => project.updateInfoEvents(30, controller.signal),
    (info) => {
      const value = (info as { value?: unknown }).value ?? ({} as Record<string, unknown>)
      if ((info as { type?: string }).type === 'start') {
        // Debounce: only announce BUILDING if the tick hasn't ended fast.
        if (defer) clearTimeout(defer)
        defer = setTimeout(() => {
          safeEmit({ type: 'building', source: 'frostfast' })
        }, buildingDeferMs)
        defer.unref?.()
      } else if ((info as { type?: string }).type === 'end') {
        if (defer) {
          clearTimeout(defer)
          defer = undefined
        }
        // The native issue shape is structured (severity + message); coerce
        // element-wise to the protocol's string[] so an overlay can never
        // render `[object Object]` for a real build error.
        const typed = value as { hash?: unknown; errors?: unknown; warnings?: unknown }
        safeEmit({
          type: 'built',
          hash: typeof typed.hash === 'string' ? typed.hash : '',
          errors: issueList(typed.errors),
          warnings: issueList(typed.warnings),
        })
      }
    },
    () => {
      // Never leave a BUILDING message dangling when the stream settles.
      if (defer) {
        clearTimeout(defer)
        defer = undefined
      }
    }
  )

  // --- per-chunk HMR streams -----------------------------------------------
  const startChunkStream = (chunkName: string, state: ChunkState): void => {
    // The native stream must die with EITHER the whole pipeline or its own
    // chunk subscription — link both signals into one.
    const linked = new AbortController()
    const link = (source: AbortSignal): void => {
      if (source.aborted) linked.abort()
      else source.addEventListener('abort', () => linked.abort(), { once: true })
    }
    link(controller.signal)
    link(state.controller.signal)

    const task = (async () => {
      let attempt = 0
      for (;;) {
        try {
          for await (const payload of project.hmrEvents(chunkName, undefined, linked.signal)) {
            if (linked.signal.aborted) return
            safeEmit({ type: 'update', payload })
            // Per-client delivery, isolated: one throwing listener must not
            // starve the others or the stream.
            for (const listener of [...state.listeners]) {
              try {
                listener(payload)
              } catch (error) {
                reportError(error)
              }
            }
          }
          return // stream ended cleanly
        } catch (error) {
          if (linked.signal.aborted) return
          reportError(error)
        }
        attempt += 1
        if (attempt > STREAM_RESTARTS) return
        if (await backoff(STREAM_BACKOFF_MS * attempt, linked.signal)) return
      }
    })()
    track(task)
    const dropIfDead = (): void => {
      // A dead stream must never look live: drop the entry so the next
      // subscribeClient starts a fresh stream instead of joining a corpse.
      if (clientSubscriptions.get(chunkName) === state) clientSubscriptions.delete(chunkName)
    }
    void task.then(dropIfDead, dropIfDead)
  }

  return {
    async subscribeClient(chunkName: string, listener?: (payload: unknown) => void) {
      let state = clientSubscriptions.get(chunkName)
      const isNew = !state
      if (!state) {
        state = { refs: 0, listeners: new Set(), controller: new AbortController() }
        clientSubscriptions.set(chunkName, state)
      }
      state.refs += 1
      if (listener) state.listeners.add(listener)

      if (isNew) startChunkStream(chunkName, state)

      // On-connect delivery to THIS client: handshake, route snapshot, then
      // the recent stream. Ephemeral messages carry id 0 (see protocol doc);
      // replayed ones keep their stream ids so a client can bookkeep gaps.
      if (listener) {
        const deliver = (message: StampedMessage): void => {
          try {
            listener(message)
          } catch (error) {
            reportError(error)
          }
        }
        deliver({ type: 'connected', sessionId, id: 0 })
        for (const pathname of currentRoutes) {
          deliver({ type: 'route-added', pathname, id: 0 })
        }
        for (const message of replay) {
          if (message.type !== 'connected') deliver(message)
        }
      }

      const subscribed = state
      return async () => {
        subscribed.refs -= 1
        if (listener) subscribed.listeners.delete(listener)
        // Last one out cancels the chunk's native stream: a browsing session
        // must never accumulate one live Rust RootTask per chunk ever visited.
        if (subscribed.refs <= 0 && clientSubscriptions.get(chunkName) === subscribed) {
          clientSubscriptions.delete(chunkName)
          subscribed.controller.abort()
        }
      }
    },

    async dispose() {
      controller.abort()
      for (const state of clientSubscriptions.values()) state.controller.abort()
      clientSubscriptions.clear()
      await Promise.all(streamTasks)
    },
  }
}

/**
 * Coerce a native diagnostics array — strings OR structured CompilationIssue
 * objects — into the protocol's string[] without ever rendering `[object
 * Object]` to the overlay.
 */
function issueList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => {
    if (typeof entry === 'string') return entry
    if (entry && typeof entry === 'object') {
      const issue = entry as { severity?: unknown; message?: unknown }
      const message =
        typeof issue.message === 'string' ? issue.message : (JSON.stringify(entry) ?? String(entry))
      return typeof issue.severity === 'string' ? `${issue.severity}: ${message}` : message
    }
    return String(entry)
  })
}
