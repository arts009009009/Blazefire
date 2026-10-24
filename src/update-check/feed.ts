/**
 * Release feed — v1 port of the GitHub Releases lookup.
 *
 * Rules kept from v1:
 *   - 4 second hard timeout (a stalled API must never stall dev startup)
 *   - every failure path is silent; a network problem yields null, never a
 *     thrown error out of next.config
 *   - repo slug is read from this package's own package.json "repository"
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PACKAGE_ROOT } from '../package-root.js'
import { compareVersions, isValidVersion } from './semver.js'
import { readState, writeState } from './state.js'

const REQUEST_TIMEOUT_MS = 4000

function readOwnPackageJson(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as Record<
    string,
    unknown
  >
}

export function getInstalledVersion(): string {
  try {
    const packageJson = readOwnPackageJson() as { version?: string }
    return packageJson.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/** `arts009009009/Blazefire` from the repository field. */
export function getRepoSlug(): string {
  try {
    const packageJson = readOwnPackageJson() as {
      repository?: string | { url?: string }
    }
    const raw =
      typeof packageJson.repository === 'string'
        ? packageJson.repository
        : (packageJson.repository?.url ?? '')
    const match = /github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(raw)
    return match ? `${match[1]}/${match[2]}` : ''
  } catch {
    return ''
  }
}

/**
 * Latest published version, or null (offline, private repo, rate-limited,
 * no releases — all indistinguishable, all silent).
 */
export async function fetchLatestVersion(): Promise<string | null> {
  const slug = getRepoSlug()
  if (!slug) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(
      `https://api.github.com/repos/${slug}/releases/latest`,
      {
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': 'blazefire-update-check',
        },
        signal: controller.signal,
      }
    )
    if (!response.ok) return null
    const payload = (await response.json()) as { tag_name?: string }
    const version = (payload.tag_name ?? '').replace(/^v/, '').trim()
    return isValidVersion(version) ? version : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export interface CheckResult {
  current: string
  latest: string | null
  updateAvailable: boolean
}

/**
 * One throttled check. Feeds the state file so the CLI and the dev-time
 * prompt share a single window (v1 parity).
 */
export async function checkForUpdate(): Promise<CheckResult> {
  const current = getInstalledVersion()

  if (!recentlyCheckedWithLatest()) {
    const latest = await fetchLatestVersion()
    if (!latest) return { current, latest: null, updateAvailable: false }
    writeState({ lastCheck: Date.now(), latestVersion: latest })
  }

  const { latestVersion } = readState()
  if (!latestVersion || !isValidVersion(latestVersion)) {
    return { current, latest: null, updateAvailable: false }
  }
  return {
    current,
    latest: latestVersion,
    updateAvailable: compareVersions(current, latestVersion) < 0,
  }
}

/** We only hit the network when the window is cold OR we never cached a version. */
function recentlyCheckedWithLatest(): boolean {
  const state = readState()
  if (typeof state.lastCheck !== 'number') return false
  // A FUTURE lastCheck (clock set backward after a check) must not freeze
  // updates until wall-clock catches up — treat it as a cold window.
  const age = Date.now() - state.lastCheck
  if (age < 0 || age >= 24 * 60 * 60 * 1000) return false
  return typeof state.latestVersion === 'string' && isValidVersion(state.latestVersion)
}
