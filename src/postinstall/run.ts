/**
 * Standalone entry — this is what `postinstall` in package.json runs.
 *
 * Hard rule from v1: a postinstall must NEVER break someone's install.
 * Every failure — no Next.js, unwritable config, malformed package.json —
 * is logged and swallowed with exit 0.
 */
import process from 'node:process'
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { run } from './activation.js'

export async function main(): Promise<void> {
  try {
    run()
  } catch (error) {
    process.stdout.write(
      `[Blazefire] skipped — ${(error as Error)?.message ?? 'unknown error'}\n`
    )
  } finally {
    process.exitCode = 0
  }
}

// Self-execute only when run directly (node dist/postinstall/run.js),
// never when imported by the CLI. argv[1] may be a symlink while
// import.meta.url is the resolved realpath — check both forms.
function invokedDirectly(): boolean {
  if (process.argv[1] === undefined) return false
  if (import.meta.url === pathToFileURL(process.argv[1]).href) return true
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
  } catch {
    return false
  }
}

if (invokedDirectly()) {
  void main()
}
