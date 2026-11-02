/**
 * HMR message vocabulary (typed, Turbopack/Frostfast only).
 *
 * v1 carried THREE pipelines (turbopack/webpack/rspack) sharing one enum of
 * 21 message kinds (spec H-02). v2 keeps only the kinds the Frostfast
 * event-stream pipeline actually produces.
 */

export type BuildStatusMessage =
  | { type: 'building'; source: 'frostfast' }
  | { type: 'built'; hash: string; errors: string[]; warnings: string[] }

export type RouteMessage =
  | { type: 'route-added'; pathname: string }
  | { type: 'route-removed'; pathname: string }

export type ServerComponentMessage = { type: 'server-component-changes' }

export type ConnectedMessage = { type: 'connected'; sessionId: number }

export type HmrMessage =
  | BuildStatusMessage
  | RouteMessage
  | ServerComponentMessage
  | ConnectedMessage
  | { type: 'update'; payload: unknown }

/**
 * Every message the pipeline emits carries a monotonic per-session `id`, so a
 * (re)connecting client can detect gaps and replay from `Last-Event-ID` —
 * the transport contract the deferred SSE/WebSocket wiring builds on.
 */
export type StampedMessage = HmrMessage & { id: number }

export const HMR_ENDPOINT = '/_next/hmr'
