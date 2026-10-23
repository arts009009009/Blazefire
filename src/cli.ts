/**
 * blazefire CLI — EXPLICIT activation (spec H-17).
 *
 * v1's postinstall silently rewrote the host's next.config.* AND injected a
 * self-perpetuating postinstall hook into the host package.json — a
 * supply-chain-style behavior. v2 never mutates a project on install. The
 * only mutation path is this CLI, which prints its plan first and applies
 * only with --yes:
 *
 *   blazefire init [--yes]   wrap next.config.* in blazefire() (with backup)
 *   blazefire restore        revert to the backed-up config
 *   blazefire --version
 */

import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BLAZEFIRE_VERSION, FROSTFAST_VERSION } from './version.js'
import { BLAZEFIRE_BRANDING } from './branding.js'

const CONFIG_NAMES = ['next.config.ts', 'next.config.mjs', 'next.config.js', 'next.config.cjs']
const BACKUP_DIR = '.blazefire'
const MARKER = '// blazefire:activated'

export async function findConfig(dir: string): Promise<string | null> {
  for (const name of CONFIG_NAMES) {
    const candidate = join(dir, name)
    try {
      await readFile(candidate, 'utf8')
      return candidate
    } catch {
      /* try next */
    }
  }
  return null
}

export interface ActivationPlan {
  configPath: string
  alreadyActive: boolean
  wrapped: string
}

export async function plan(dir: string): Promise<ActivationPlan> {
  const configPath = await findConfig(dir)
  if (!configPath) {
    throw new Error(
      `No next.config.* found in ${dir}. Create one, then re-run \`blazefire init\`.`
    )
  }
  const source = await readFile(configPath, 'utf8')
  if (source.includes(MARKER)) {
    return { configPath, alreadyActive: true, wrapped: source }
  }

  const importLine = `import blazefire from 'blazefire/plugin'\n`
  const hasEsmExport = /export\s+default\s/.test(source)
  const wrapped = hasEsmExport
    ? `${importLine}${MARKER}\n${source.replace(/export\s+default\s+/, 'export default blazefire(')}\n`
    : `${importLine}${MARKER}\n// CJS config: export your config as \`config\` and let the wrap re-export it.\nmodule.exports = blazefire(require('./next.config.cjs.orig'))\n`

  return { configPath, alreadyActive: false, wrapped }
}

export async function apply(dir: string): Promise<string> {
  const p = await plan(dir)
  if (p.alreadyActive) return p.configPath

  await mkdir(join(dir, BACKUP_DIR), { recursive: true })
  await copyFile(p.configPath, join(dir, BACKUP_DIR, 'next.config.backup'))
  await writeFile(p.configPath, p.wrapped, 'utf8')
  return p.configPath
}

export async function restore(dir: string): Promise<string | null> {
  const backup = join(dir, BACKUP_DIR, 'next.config.backup')
  const configPath = (await findConfig(dir)) ?? join(dir, CONFIG_NAMES[0]!)
  try {
    await copyFile(backup, configPath)
    await rm(join(dir, BACKUP_DIR), { recursive: true, force: true })
    return configPath
  } catch {
    return null
  }
}

export async function main(argv: string[], cwd = process.cwd()): Promise<void> {
  const command = argv[0] ?? '--help'
  const yes = argv.includes('--yes')

  switch (command) {
    case 'init':
    case 'setup': {
      const p = await plan(cwd)
      if (p.alreadyActive) {
        console.log(`blazefire: ${p.configPath} is already active`)
        return
      }
      console.log(`blazefire: would wrap ${p.configPath} in blazefire()`)
      console.log('--- preview ---')
      console.log(p.wrapped.slice(0, 400))
      if (!yes) {
        console.log('\nRe-run with --yes to apply (a backup is written to .blazefire/).')
        return
      }
      const applied = await apply(cwd)
      console.log(`blazefire: activated ${applied} (backup in .blazefire/)`)
      return
    }
    case 'restore':
    case 'revert': {
      const restored = await restore(cwd)
      console.log(restored ? `blazefire: restored ${restored}` : 'blazefire: nothing to restore')
      return
    }
    case '--version':
    case 'version':
      console.log(`blazefire ${BLAZEFIRE_VERSION} (Frostfast ${FROSTFAST_VERSION})`)
      return
    default:
      console.log(
        [
          BLAZEFIRE_BRANDING.banner,
          '',
          'Usage:',
          '  blazefire init [--yes]   activate Blazefire (prints a preview first)',
          '  blazefire restore        revert to the backed-up config',
          '  blazefire --version      print versions',
        ].join('\n')
      )
  }
}

// Run only when executed directly — importing this module (tests) must not
// consume argv.
const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
