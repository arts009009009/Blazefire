/**
 * Update-check throttle state — v1 port.
 *
 * One attempt per rolling 24h window, persisted in the OS temp dir. State
 * loss is irrelevant (worst case: one extra check), so every read/write is
 * best-effort and silent.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

export interface UpdateState {
  lastCheck?: number
  latestVersion?: string
}

export function stateFile(): string {
  return path.join(os.tmpdir(), 'blazefire-update-check.json')
}

export function readState(): UpdateState {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile(), 'utf8')) as UpdateState
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

export function writeState(state: UpdateState): void {
  try {
    fs.writeFileSync(stateFile(), JSON.stringify(state))
  } catch {
    // Unwritable temp dir just means we check more often. Never fatal.
  }
}

export function recentlyChecked(): boolean {
  const { lastCheck } = readState()
  if (typeof lastCheck !== 'number' || !Number.isFinite(lastCheck)) return false
  // A FUTURE lastCheck (clock set backward after a check) must not suppress
  // all checks until wall-clock catches up — treat it as a cold window.
  const age = Date.now() - lastCheck
  return age >= 0 && age < CHECK_INTERVAL_MS
}
