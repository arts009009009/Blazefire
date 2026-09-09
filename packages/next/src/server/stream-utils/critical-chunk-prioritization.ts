/**
 * Critical Chunk Prioritization for Frostfast Streaming SSR
 *
 * This module provides utilities for prioritizing critical chunks (CSS, JS)
 * during streaming rendering to improve perceived performance.
 *
 * Frostfast — Bundling at the speed of chaos.
 */

export type ChunkPriority = 'critical' | 'high' | 'normal' | 'low'

export interface ChunkMetadata {
  type: 'css' | 'js' | 'html' | 'data' | 'other'
  priority: ChunkPriority
  size: number
  route?: string
}

/**
 * Priority levels for streaming chunks.
 * Higher priority chunks are sent first to improve TTFB and LCP.
 */
export const PRIORITY_LEVELS: Record<ChunkPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
}

/**
 * Determines the priority of a chunk based on its content type and usage.
 */
export function getChunkPriority(metadata: ChunkMetadata): ChunkPriority {
  // CSS is always critical for rendering
  if (metadata.type === 'css') {
    return 'critical'
  }

  // Inline JS that affects rendering is high priority
  if (metadata.type === 'js') {
    return 'high'
  }

  // HTML shell is critical
  if (metadata.type === 'html') {
    return 'critical'
  }

  // RSC data is normal priority (hydration can wait)
  if (metadata.type === 'data') {
    return 'normal'
  }

  return 'normal'
}

/**
 * Creates a priority-aware transform stream that reorders chunks
 * based on their priority level.
 */
export function createPriorityTransformStream(): TransformStream<
  Uint8Array,
  Uint8Array
> {
  const pendingChunks: Array<{
    data: Uint8Array
    priority: ChunkPriority
  }> = []
  let doneReading = false

  return new TransformStream({
    transform(chunk, controller) {
      // For now, pass through directly
      // In a full implementation, this would buffer and reorder
      controller.enqueue(chunk)
    },
  })
}

/**
 * Identifies if a chunk contains critical rendering resources.
 * Critical resources include:
 * - CSS stylesheets
 * - Critical inline scripts
 * - HTML shell content
 */
export function isCriticalChunk(chunk: Uint8Array): boolean {
  const text = new TextDecoder().decode(chunk)

  // Check for CSS
  if (
    text.includes('<style') ||
    text.includes('stylesheet') ||
    text.includes('.css')
  ) {
    return true
  }

  // Check for critical inline scripts
  if (
    text.includes('__next_f') ||
    text.includes('self.__next') ||
    text.includes('next/script')
  ) {
    return true
  }

  // Check for HTML shell
  if (text.includes('<html') || text.includes('<head') || text.includes('<body')) {
    return true
  }

  return false
}

/**
 * Estimates the size impact of a chunk on perceived performance.
 * Smaller critical chunks should be sent first.
 */
export function estimateChunkImpact(chunk: Uint8Array): number {
  const priority = isCriticalChunk(chunk) ? 'critical' : 'normal'
  const priorityWeight = PRIORITY_LEVELS[priority]
  const sizeWeight = Math.log2(chunk.length + 1)

  // Lower score = higher priority
  return priorityWeight * 1000 + sizeWeight
}
