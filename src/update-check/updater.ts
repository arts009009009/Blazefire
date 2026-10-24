/**
 * The updater + dev-time prompt — v1 port.
 *
 * v1 design rules kept verbatim:
 *   1. never break the host build (wrapped; silence on every failure)
 *   2. never block (the dev-time check is fire-and-forget)
 *   3. never nag (TTY-only, non-CI, one prompt per 24h window)
 */
import { spawnSync } from 'node:child_process'
import { checkForUpdate } from './feed.js'
import {
  detectPackageManager,
  isSafeSpec,
  readInstalledSpec,
  resolveProjectRoot,
  updateCommand,
} from './pm.js'
import { recentlyChecked, writeState } from './state.js'

const SKIP_ENV = 'BLAZEFIRE_SKIP_UPDATE_CHECK'

export interface RunUpdateOptions {
  projectRoot?: string
  onLog?: (message: string) => void
}

/**
 * Re-install the latest release through the project's own package manager.
 * Resolves with the exit code (0 = updated); never throws.
 */
export async function runUpdate(options: RunUpdateOptions = {}): Promise<number> {
  try {
    const projectRoot = options.projectRoot ?? resolveProjectRoot() ?? process.cwd()
    const log = options.onLog ?? ((message: string) => process.stdout.write(`${message}\n`))

    const projectSpec = readInstalledSpec(projectRoot)
    if (projectSpec && !isSafeSpec(projectSpec)) {
      log(`refusing to overwrite the pinned spec "${projectSpec}"`)
      return 1
    }

    const { latest, current } = await checkForUpdate()
    if (!latest) {
      log('could not reach the release feed — try again shortly')
      return 1
    }

    const manager = detectPackageManager(projectRoot)
    log(`updating blazefire ${current} → ${latest} with ${manager}`)

    const { command, args } = updateCommand(manager, latest)
    const result = spawnSync(command, args, {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })

    const code = result.status ?? 1
    if (code === 0) {
      writeState({ lastCheck: Date.now(), latestVersion: latest })
      log('updated — restart your dev server to pick it up')
    } else {
      log(`update failed (exit ${code})`)
    }
    return code
  } catch {
    return 1
  }
}

function canPrompt(): boolean {
  return (
    process.stdin.isTTY === true &&
    process.stdout.isTTY === true &&
    !process.env.CI &&
    process.env[SKIP_ENV] !== '1'
  )
}

function promptYesNo(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const ask = (): void => {
      process.stdout.write(question)
    }
    const onData = (chunk: Buffer): void => {
      cleanup()
      const answer = chunk.toString('trim' in String.prototype ? 'utf8' : 'utf8').trim().toLowerCase()
      resolve(answer === 'y' || answer === 'yes')
    }
    const onEnd = (): void => {
      cleanup()
      resolve(false)
    }
    const cleanup = (): void => {
      process.stdin.off('data', onData)
      process.stdin.off('end', onEnd)
      process.stdin.setRawMode?.(false)
      process.stdin.pause()
    }
    process.stdin.on('data', onData)
    process.stdin.on('end', onEnd)
    process.stdin.setRawMode?.(true)
    process.stdin.resume()
    ask()
  })
}

/**
 * Called by the plugin during `next dev` config evaluation. Fire-and-forget:
 * the returned promise is intentionally not awaited by callers, and every
 * failure resolves to silence.
 */
export async function maybeNotify(): Promise<void> {
  try {
    if (process.env[SKIP_ENV] === '1' || !canPrompt()) return
    if (recentlyChecked()) return

    const { updateAvailable, latest, current } = await checkForUpdate()
    if (!updateAvailable || !latest) return

    const answer = await promptYesNo(
      `[Blazefire] v${latest} is available (you have ${current}). Update now? (y/N) `
    )
    if (!answer) return
    await runUpdate()
  } catch {
    // A dev-time update prompt must never surface as an error.
  }
}
