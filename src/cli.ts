#!/usr/bin/env node
/**
 * blazefire CLI — v1 command surface, ported.
 *
 *   npx blazefire init | setup | activate   wire Blazefire into next.config.*
 *   npx blazefire restore | revert          put the original back
 *   npx blazefire update | upgrade          re-install the latest release
 *   npx blazefire check | outdated          report installed vs latest
 *   npx blazefire --version | --help
 *
 * init/restore run the SAME engine as the postinstall (src/postinstall) —
 * there is deliberately one implementation of the rewrite, not two.
 */
import { pathToFileURL } from 'node:url'
import { BLAZEFIRE_BRANDING } from './branding.js'
import { run, restore } from './postinstall/index.js'
import {
  checkForUpdate,
  getInstalledVersion,
  maybeNotify,
  runUpdate,
} from './update-check/index.js'
import { BLAZEFIRE_VERSION, FROSTFAST_VERSION } from './version.js'

const HELP = `
Blazefire

  npx blazefire init      wire Blazefire into this project's next.config.*
  npx blazefire restore   put the original back from "Blazefire Backup/"
  npx blazefire update    re-install the latest Blazefire release
  npx blazefire check     report the installed and latest version
  npx blazefire --version print the installed version

  Init backs the original up first and never runs twice on the same file.
  If the config shape is not recognised it prints exactly what to paste
  instead of guessing.

  It also writes a "postinstall" hook into your package.json so the
  activation keeps applying on a fresh install. Remove it with
  \`npx blazefire restore\`.

  Set BLAZEFIRE_SKIP_AUTO=1 to opt out of the automatic activation.
`.trim()

/**
 * The engine call — the same as the postinstall. Returns an exit code:
 * 0 = activated (or already active), 1 = skipped/failed.
 */
function init(): number {
  try {
    run()
    return 0
  } catch (error) {
    process.stderr.write(
      `[Blazefire] activation failed: ${(error as Error)?.message ?? error}\n`
    )
    return 1
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const command = argv[0] ?? '--help'

  switch (command) {
    case 'init':
    case 'setup':
    case 'activate':
      return init()

    case 'restore':
    case 'revert':
      try {
        return restore() ? 0 : 1
      } catch (error) {
        process.stderr.write(
          `[Blazefire] restore failed: ${(error as Error)?.message ?? error}\n`
        )
        return 1
      }

    case 'update':
    case 'upgrade':
      return runUpdate()

    case 'check':
    case 'check-update':
    case 'outdated': {
      const { current, latest, updateAvailable } = await checkForUpdate()
      if (!latest) {
        process.stdout.write(
          `blazefire ${current} — could not reach the release feed\n`
        )
        return 1
      }
      process.stdout.write(
        `blazefire ${current} → ${latest} ${updateAvailable ? '(update available)' : '(up to date)'}\n`
      )
      return 0
    }

    case '--version':
    case '-v':
    case 'version':
      process.stdout.write(
        `blazefire ${BLAZEFIRE_VERSION} (Frostfast ${FROSTFAST_VERSION})\n`
      )
      return 0

    case '--help':
    case '-h':
    case 'help':
      process.stdout.write(`${HELP}\n\n${BLAZEFIRE_BRANDING.banner}\n`)
      return 0

    default:
      process.stderr.write(
        `blazefire: unknown command "${command}"\n\n${HELP}\n`
      )
      return 1
  }
}

export { maybeNotify }

// Run only when executed directly — importing this module (tests, the
// postinstall engine) must never consume argv.
const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) {
  main()
    .then((code) => {
      process.exitCode = code
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    })
}
