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
 */

import { getRouteNames, type FrostfastProject } from '../compiler/project.js'
import type { HmrMessage } from './hmr-protocol.js'

export interface HotReloaderOptions {
  project: FrostfastProject
  emit: (message: HmrMessage) => void
  /** Report errors from detached native event-stream consumers. */
  onError?: (error: unknown) => void
  /** Defer 'building' so instant rebuilds don't flicker. */
  buildingDeferMs?: number
}

export interface HotReloader {
  /** Subscribe a client to a chunk's HMR updates. Returns unsubscribe. */
  subscribeClient(chunkName: string, listener?: (payload: unknown) => void): Promise<() => Promise<void>>
  /** Abort all stream consumption and release resources. */
  dispose(): Promise<void>
}

export async function createHotReloader(options: HotReloaderOptions): Promise<HotReloader> {
  const { project, emit } = options
  const buildingDeferMs = options.buildingDeferMs ?? 100
  const onError =
    options.onError ??
    ((error: unknown) => console.error('[Blazefire] hot-reloader stream failed', error))
  const controller = new AbortController()
  const clientSubscriptions = new Map<string, Set<(payload: unknown) => void>>()
  const streamTasks = new Set<Promise<void>>()

  const reportError = (error: unknown): void => {
    try {
      onError(error)
    } catch (callbackError) {
      console.error('[Blazefire] hot-reloader error handler failed', callbackError)
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

  // --- route graph ---------------------------------------------------------
  track((async () => {
    let known = new Set<string>()
    try {
      for await (const entrypoints of project.entrypointEvents(controller.signal)) {
        if (controller.signal.aborted) return
        const next = new Set(getRouteNames(entrypoints))
        for (const route of next) {
          if (!known.has(route)) emit({ type: 'route-added', pathname: route })
        }
        for (const route of known) {
          if (!next.has(route)) emit({ type: 'route-removed', pathname: route })
        }
        known = next
      }
    } catch (error) {
      if (!controller.signal.aborted) reportError(error)
    }
  })())

  // --- build status --------------------------------------------------------
  track((async () => {
    let defer: ReturnType<typeof setTimeout> | undefined
    try {
      for await (const info of project.updateInfoEvents(30, controller.signal)) {
        if (controller.signal.aborted) return
        if (info.type === 'start') {
          // Debounce: only announce BUILDING if the tick hasn't ended fast.
          if (defer) clearTimeout(defer)
          defer = setTimeout(() => emit({ type: 'building', source: 'frostfast' }), buildingDeferMs)
          defer.unref?.()
        } else if (info.type === 'end') {
          if (defer) {
            clearTimeout(defer)
            defer = undefined
          }
          emit({
            type: 'built',
            hash: '',
            errors: [],
            warnings: [],
          })
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) reportError(error)
    } finally {
      if (defer) clearTimeout(defer)
    }
  })())

  return {
    async subscribeClient(chunkName: string, listener?: (payload: unknown) => void) {
      let listeners = clientSubscriptions.get(chunkName)
      const isNew = !listeners
      listeners ??= new Set()
      if (listener) listeners.add(listener)
      clientSubscriptions.set(chunkName, listeners)

      if (isNew) {
        // Own stream per chunk; consumed until dispose().
        track((async () => {
          try {
            for await (const payload of project.hmrEvents(
              chunkName,
              undefined,
              controller.signal
            )) {
              if (controller.signal.aborted) return
              emit({ type: 'update', payload })
              for (const l of clientSubscriptions.get(chunkName) ?? []) {
                l(payload)
              }
            }
          } catch (error) {
            if (!controller.signal.aborted) reportError(error)
          }
        })())
      }

      return async () => {
        if (listener) listeners.delete(listener)
      }
    },

    async dispose() {
      controller.abort()
      clientSubscriptions.clear()
      await Promise.all(streamTasks)
    },
  }
}
