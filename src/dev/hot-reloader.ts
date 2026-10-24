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
  const controller = new AbortController()
  const clientSubscriptions = new Map<string, Set<(payload: unknown) => void>>()

  // --- route graph ---------------------------------------------------------
  void (async () => {
    let known = new Set<string>()
    try {
      for await (const entrypoints of project.entrypointEvents()) {
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
      if (!controller.signal.aborted) throw error
    }
  })()

  // --- build status --------------------------------------------------------
  void (async () => {
    let defer: ReturnType<typeof setTimeout> | undefined
    try {
      for await (const info of project.updateInfoEvents(30)) {
        if (controller.signal.aborted) return
        if (info.type === 'start') {
          // Debounce: only announce BUILDING if the tick hasn't ended fast.
          defer = setTimeout(() => emit({ type: 'building', source: 'frostfast' }), buildingDeferMs)
          defer.unref?.()
        } else if (info.type === 'end') {
          if (defer) clearTimeout(defer)
          emit({
            type: 'built',
            hash: '',
            errors: [],
            warnings: [],
          })
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error
    }
  })()

  return {
    async subscribeClient(chunkName: string, listener?: (payload: unknown) => void) {
      let listeners = clientSubscriptions.get(chunkName)
      const isNew = !listeners
      listeners ??= new Set()
      if (listener) listeners.add(listener)
      clientSubscriptions.set(chunkName, listeners)

      if (isNew) {
        // Own stream per chunk; consumed until dispose().
        void (async () => {
          try {
            for await (const payload of project.hmrEvents(chunkName)) {
              if (controller.signal.aborted) return
              emit({ type: 'update', payload })
              for (const l of clientSubscriptions.get(chunkName) ?? []) {
                l(payload)
              }
            }
          } catch (error) {
            if (!controller.signal.aborted) throw error
          }
        })()
      }

      return async () => {
        if (listener) listeners.delete(listener)
      }
    },

    async dispose() {
      controller.abort()
      clientSubscriptions.clear()
    },
  }
}
