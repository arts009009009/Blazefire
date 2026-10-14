#!/usr/bin/env node
/**
 * `npx blazefire init` / `npx blazefire restore`
 *
 * Fallback for the cases where a postinstall cannot do the job:
 *   - `ignore-scripts=true` (common in CI)
 *   - Yarn Berry with `enableScripts: false`, or PnP (no node_modules)
 *   - the config could not be recognised automatically
 *
 * Same engine as the postinstall — there is deliberately one implementation
 * of the rewrite, not two.
 */
'use strict'

const api = require('./postinstall.cjs')

const HELP = `
Blazefire

  npx blazefire init      wire Blazefire into this project's next.config.*
  npx blazefire restore   put the original back from "Blazefire Backup/"
  npx blazefire update    re-install the latest Blazefire release
  npx blazefire check     report the installed and latest version

  Init backs the original up first and never runs twice on the same file.
  If the config shape is not recognised it prints exactly what to paste
  instead of guessing.

  It also writes a "postinstall" hook into your package.json (chaining onto
  any you already have), so pnpm and bun — which refuse to run a dependency's
  own postinstall — still self-activate on every install. "restore" removes
  that hook again.

  Update re-runs your package manager's add for the specifier you installed
  with (a branch re-resolves to its tip; an immutable tarball URL resolves to
  the same commit). On \`next dev\` Blazefire offers this same update at most
  once per 24 hours; answering no just continues your dev server.

  Opt out of auto-activation on install with BLAZEFIRE_SKIP_AUTO=1.
  Opt out of the update check with BLAZEFIRE_SKIP_UPDATE_CHECK=1.
`

const command = (process.argv[2] || 'init').toLowerCase()

function bail(message) {
  console.error('  blazefire: ' + message)
  process.exitCode = 1
}

try {
  if (command === 'init' || command === 'setup' || command === 'activate') {
    const status = api.run({ cli: true })
    // Distinguish "did nothing" from "did it" so CI/scripts can react — but
    // only when a person asked. When we are the project's own postinstall,
    // "nothing to do" must exit 0 or a `next.config` deletion would brick
    // every future install.
    if (
      (status === 'manual' || status === 'not-found') &&
      !api.isLifecycleHook()
    ) {
      process.exitCode = 1
    }
  } else if (command === 'restore' || command === 'revert') {
    process.exitCode = api.restore()
  } else if (command === 'update' || command === 'upgrade') {
    // Async on purpose: the install is a child process, and nothing below
    // this block depends on it. Callback sets the exit code rather than
    // awaiting, so the CLI's synchronous shape is preserved.
    const updates = require('./update-check.cjs')
    const here = process.cwd()
    const current = updates.getInstalledVersion()
    console.log('  blazefire: updating from v' + (current || '?') + '…')
    updates.runUpdate(here, function (code) {
      if (code === 0) {
        console.log('  blazefire: done. Restart your dev server to pick it up.')
      } else {
        console.error('  blazefire: update failed (exit ' + code + ').')
        process.exitCode = 1
      }
    })
  } else if (
    command === 'check' ||
    command === 'check-update' ||
    command === 'outdated'
  ) {
    const updates = require('./update-check.cjs')
    updates.checkForUpdate().then(function (info) {
      if (!info) {
        console.log(
          '  blazefire: could not reach the update feed (offline, or no releases published).'
        )
        return
      }
      console.log(
        '  blazefire: installed v' +
          info.current +
          ', latest v' +
          info.latest +
          '.'
      )
      if (info.updateAvailable) {
        console.log('  Run `npx blazefire update` to install it.')
      } else {
        console.log('  You are up to date.')
      }
    })
  } else if (command === '--help' || command === '-h' || command === 'help') {
    console.log(HELP.trim())
  } else {
    bail('unknown command "' + command + '". Try: npx blazefire init')
  }
} catch (error) {
  bail(
    (error && error.message ? error.message : String(error)) +
      ' — nothing was written.'
  )
  process.exitCode = 1
}
