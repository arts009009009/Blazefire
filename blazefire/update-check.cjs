/**
 * Blazefire update check + updater.
 *
 * Two entry points, one implementation:
 *
 *   - maybeNotify()   called by the next.config plugin on `next dev`. Asks
 *                     "update now?" once per 24h and, on yes, runs the same
 *                     update the CLI runs.
 *   - runUpdate()     called by `blazefire update` (and by maybeNotify).
 *
 * Design rules, in priority order:
 *
 *   1. Never break the host build. Every path is wrapped; a failed network
 *      call, an unwritable cache file or a missing package manager all end
 *      in silence, never a thrown error out of next.config.
 *   2. Never block. The dev-time check is fire-and-forget — config resolution
 *      does not await it, so a slow GitHub API cannot stall startup.
 *   3. Never nag. One attempt per rolling 24h window, and only from an
 *      interactive TTY outside CI.
 */

'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { spawn } = require('child_process')

/** Where updates come from. Overridable for testing and for forks. */
const DEFAULT_REPO = 'arts009009009/Blazefire'

/** Roll the "already asked" window. 24h, measured in UTC epoch ms. */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

/** Don't let a stalled request hold the dev process open. */
const REQUEST_TIMEOUT_MS = 4000

/** Give up on an unanswered prompt rather than leaving stdin hooked. */
const PROMPT_TIMEOUT_MS = 30 * 1000

/**
 * Read our own version. `../package.json` is the published manifest, which is
 * the thing actually installed in the user's project.
 */
function getInstalledVersion() {
  try {
    return require('../package.json').version
  } catch (_) {
    return null
  }
}

/**
 * `owner/repo` for the update feed, read from our own manifest so a fork
 * checks its own releases rather than upstream's.
 */
function getRepoSlug() {
  try {
    const pkg = require('../package.json')
    const url = (pkg.repository && (pkg.repository.url || pkg.repository)) || ''
    const m = String(url).match(/github\.com[/:]([^/]+)\/([^/.]+)/)
    if (m) return m[1] + '/' + m[2]
  } catch (_) {
    /* fall through */
  }
  return DEFAULT_REPO
}

/**
 * Loose semver compare: -1 when a < b, 0 when equal, 1 when a > b.
 *
 * Only the numeric triple matters here — GitHub's "latest" release is always
 * a stable tag, and prerelease suffixes (the repo has `v1.0.1-blazefire-pnpm`)
 * rank below the release of the same number so a stray prerelease tag can
 * never look newer than the real thing.
 */
function compareVersions(a, b) {
  const parse = (v) => {
    const m = String(v || '')
      .trim()
      .replace(/^[vV]/, '')
      .match(/^(\d+)\.(\d+)\.(\d+)(.*)$/)
    if (!m) return null
    return {
      major: Number(m[1]),
      minor: Number(m[2]),
      patch: Number(m[3]),
      pre: m[4] || '',
    }
  }

  const x = parse(a)
  const y = parse(b)
  if (!x || !y) return 0

  const keys = ['major', 'minor', 'patch']
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    if (x[key] !== y[key]) return x[key] < y[key] ? -1 : 1
  }

  // Same number: a release outranks a prerelease of that number.
  if (x.pre === y.pre) return 0
  if (x.pre === '') return 1
  if (y.pre === '') return -1
  return x.pre < y.pre ? -1 : 1
}

/**
 * Latest published release tag, or null on any failure.
 *
 * The Releases endpoint (not /tags) because it gives the version users should
 * actually move to, and it 404s cleanly on repos with no releases at all.
 */
async function fetchLatestVersion() {
  if (typeof fetch !== 'function') return null

  const url =
    'https://api.github.com/repos/' + getRepoSlug() + '/releases/latest'

  const controller =
    typeof AbortController === 'function' ? new AbortController() : null
  const timer = setTimeout(function () {
    if (controller) controller.abort()
  }, REQUEST_TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      headers: { accept: 'application/vnd.github+json' },
      signal: controller ? controller.signal : undefined,
    })
    if (!res.ok) return null
    const body = await res.json()
    const tag = body && body.tag_name
    return tag ? String(tag) : null
  } catch (_) {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/* ------------------------------------------------------------------ *
 * throttle state
 *
 * Kept in the OS temp dir, never in the user's project — a dev server must
 * not leave files behind. Keyed by the project root so two apps on one
 * machine nag independently (and so one app saying "no" silences the rest).
 *
 * The window is a plain rolling 24h gap between checks, which is inherently
 * timezone-free: it does not matter what the user's clock says, only how long
 * since the last attempt. That is what makes "once a day" true everywhere.
 * ------------------------------------------------------------------ */

function stateFile(projectRoot) {
  const key = crypto
    .createHash('sha1')
    .update(String(projectRoot || process.cwd()))
    .digest('hex')
    .slice(0, 16)
  return path.join(os.tmpdir(), 'blazefire-update-' + key + '.json')
}

function readState(projectRoot) {
  try {
    return JSON.parse(fs.readFileSync(stateFile(projectRoot), 'utf8'))
  } catch (_) {
    return {}
  }
}

function writeState(projectRoot, patch) {
  try {
    const next = Object.assign(readState(projectRoot), patch)
    fs.writeFileSync(stateFile(projectRoot), JSON.stringify(next))
    return true
  } catch (_) {
    // Read-only temp dir, sandboxed CI, whatever — the cost is one extra
    // check per run, never a crash.
    return false
  }
}

/** Have we already checked within the rolling window? */
function recentlyChecked(projectRoot, now) {
  const state = readState(projectRoot)
  const last = Number(state.lastCheck) || 0
  return now - last < CHECK_INTERVAL_MS
}

/* ------------------------------------------------------------------ *
 * package manager detection + the actual update
 * ------------------------------------------------------------------ */

/** Which manager invoked us, from the env every PM sets while running us. */
function detectPackageManager(projectRoot) {
  const ua = process.env.npm_config_user_agent || ''
  const name = ua.split('/')[0]
  if (name === 'npm' || name === 'yarn' || name === 'pnpm' || name === 'bun') {
    return name
  }

  // Not run through a PM (plain `node .../cli.cjs update`) — infer from
  // the lockfiles in the project that actually holds the dependency.
  try {
    if (fs.existsSync(path.join(projectRoot, 'pnpm-lock.yaml'))) return 'pnpm'
    if (fs.existsSync(path.join(projectRoot, 'yarn.lock'))) return 'yarn'
    if (
      fs.existsSync(path.join(projectRoot, 'bun.lockb')) ||
      fs.existsSync(path.join(projectRoot, 'bun.lock'))
    ) {
      return 'bun'
    }
  } catch (_) {
    /* fall through */
  }
  return 'npm'
}

/**
 * The specifier the user installed us with — a branch, a tag, a tarball URL.
 *
 * Re-adding the *same* spec is what "update" means for a git dependency: a
 * `github:owner/repo` ref re-resolves to the branch tip, while an immutable
 * tarball URL correctly resolves to the same commit (nothing to update to,
 * and pretending otherwise would be a lie).
 */
function readInstalledSpec(projectRoot) {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')
    )
    const bags = ['dependencies', 'devDependencies', 'optionalDependencies']
    for (let i = 0; i < bags.length; i++) {
      const deps = pkg[bags[i]]
      if (deps && typeof deps.blazefire === 'string' && deps.blazefire) {
        return deps.blazefire
      }
    }
  } catch (_) {
    /* fall through */
  }
  return 'github:' + getRepoSlug()
}

/** The `<pm> add <spec>` invocation for a manager. */
function updateCommand(projectRoot, manager) {
  const spec = readInstalledSpec(projectRoot)
  switch (manager) {
    case 'yarn':
      return { command: 'yarn', args: ['add', spec] }
    case 'pnpm':
      return { command: 'pnpm', args: ['add', spec] }
    case 'bun':
      return { command: 'bun', args: ['add', spec] }
    default:
      return { command: 'npm', args: ['install', spec] }
  }
}

/**
 * Re-install blazefire in `projectRoot`, streaming the PM's own output.
 *
 * Calls back with the child's exit code (never rejects) so callers can report
 * without a try/catch of their own.
 */
function runUpdate(projectRoot, callback) {
  const root = projectRoot || process.cwd()
  const manager = detectPackageManager(root)
  const cmd = updateCommand(root, manager)
  const command = cmd.command
  const args = cmd.args

  const isWin = process.platform === 'win32'
  const child = isWin
    ? spawn(command + ' ' + args.join(' '), {
        cwd: root,
        stdio: 'inherit',
        shell: true,
        env: process.env,
      })
    : spawn(command, args, {
        cwd: root,
        stdio: 'inherit',
        env: process.env,
      })

  let settled = false
  const done = function (code) {
    if (settled) return
    settled = true
    if (typeof callback === 'function') callback(code)
  }

  child.on('error', function () {
    // `pnpm`/`bun` not installed, a shim we cannot exec, etc.
    done(1)
  })
  child.on('close', function (code) {
    done(code == null ? 1 : code)
  })
}

/* ------------------------------------------------------------------ *
 * interactive prompt
 * ------------------------------------------------------------------ */

/** Can we meaningfully ask a question right now? */
function canPrompt() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY) && !process.env.CI
}

/**
 * Ask a yes/no question, defaulting to yes.
 *
 * Answers on the first keypress (no Enter needed) when stdin is a real
 * terminal, and always tears the listener down — on an answer, on Ctrl-C, or
 * after PROMPT_TIMEOUT_MS — so the dev server's stdin is left exactly as it
 * was found.
 */
function promptYesNo(question, callback) {
  if (!canPrompt()) {
    callback(false)
    return
  }

  const stdin = process.stdin
  let settled = false
  let timer = null

  const cleanup = function () {
    if (timer) clearTimeout(timer)
    timer = null
    try {
      stdin.removeListener('data', onData)
      if (stdin.isTTY && typeof stdin.setRawMode === 'function') {
        stdin.setRawMode(false)
      }
      stdin.pause()
    } catch (_) {
      /* already gone */
    }
  }

  const finish = function (answer) {
    if (settled) return
    settled = true
    cleanup()
    process.stdout.write('\n')
    callback(answer)
  }

  const onData = function (chunk) {
    const key = String(chunk)
    // Ctrl-C / Ctrl-D: treat as "no, carry on" rather than killing dev.
    if (key === '\u0003' || key === '\u0004') return finish(false)
    const first = key.trim().charAt(0).toLowerCase()
    if (first === 'y') return finish(true)
    if (first === 'n') return finish(false)
    // Bare Enter (or any other key) takes the default: yes.
    if (first === '') return finish(true)
  }

  try {
    if (stdin.isTTY && typeof stdin.setRawMode === 'function') {
      stdin.setRawMode(true)
    }
    stdin.resume()
    stdin.addListener('data', onData)
  } catch (_) {
    settled = true
    return callback(false)
  }

  process.stdout.write(question)
  timer = setTimeout(function () {
    finish(false)
  }, PROMPT_TIMEOUT_MS)
}

/* ------------------------------------------------------------------ *
 * dev-time notification
 * ------------------------------------------------------------------ */

/**
 * Is this process a `next dev` in an interactive terminal?
 *
 * Config is evaluated for dev, build and start alike, so the dev subcommand
 * is matched off argv (npm/yarn/pnpm/bun all leave `next dev` intact in
 * argv). Build and start stay silent: a prompt there would land in CI logs
 * or block a production server start.
 */
function shouldNotify() {
  if (process.env.BLAZEFIRE_SKIP_UPDATE_CHECK) return false
  if (process.env.CI) return false
  if (!process.stdout.isTTY) return false

  const argv = process.argv.slice(2)
  return argv.indexOf('dev') !== -1
}

/**
 * Check for a newer release and, at most once per 24h, offer to install it.
 *
 * Fire-and-forget: returns immediately, never throws.
 */
function maybeNotify() {
  try {
    if (!shouldNotify()) return

    const projectRoot = process.cwd()
    const now = Date.now()
    if (recentlyChecked(projectRoot, now)) return

    // Stamp before the network call so a slow or failing check still counts
    // against the window — otherwise a flaky connection nags every run.
    writeState(projectRoot, { lastCheck: now })

    checkForUpdate().then(function (info) {
      if (!info || !info.updateAvailable) return

      const line =
        '\n  blazefire: v' +
        info.latest +
        ' is available (you have v' +
        info.current +
        ').\n'

      promptYesNo(line + '  Update now? [Y/n] ', function (yes) {
        if (!yes) {
          // "No" continues dev untouched — nothing else to do.
          return
        }
        process.stdout.write('  blazefire: updating…\n')
        runUpdate(projectRoot, function (code) {
          if (code === 0) {
            process.stdout.write(
              '  blazefire: updated. Restart your dev server to pick it up.\n'
            )
          } else {
            process.stdout.write(
              '  blazefire: update failed (exit ' +
                code +
                '). Run `npx blazefire update` to retry.\n'
            )
          }
        })
      })
    })
  } catch (_) {
    // A notifier must never be the reason a dev server fails to start.
  }
}

/**
 * Non-interactive check, used by `blazefire update --check` and tests.
 *
 * @returns {Promise<null | {current: string, latest: string, updateAvailable: boolean}>}
 */
async function checkForUpdate() {
  const current = getInstalledVersion()
  if (!current) return null

  const latest = await fetchLatestVersion()
  if (!latest) return null

  return {
    current: current,
    latest: latest,
    updateAvailable: compareVersions(latest, current) > 0,
  }
}

module.exports = {
  CHECK_INTERVAL_MS,
  REQUEST_TIMEOUT_MS,
  checkForUpdate,
  compareVersions,
  detectPackageManager,
  fetchLatestVersion,
  getInstalledVersion,
  getRepoSlug,
  maybeNotify,
  promptYesNo,
  readInstalledSpec,
  readState,
  recentlyChecked,
  runUpdate,
  shouldNotify,
  stateFile,
  updateCommand,
  writeState,
}
