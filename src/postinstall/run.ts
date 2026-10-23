/**
 * Standalone entry — this is what `postinstall` in package.json runs.
 *
 * Hard rule from v1: a postinstall must NEVER break someone's install.
 * Every failure — no Next.js, unwritable config, malformed package.json —
 * is logged and swallowed with exit 0.
 */
import process from 'node:process'
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
// never when imported by the CLI.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href.replace(/\\/g, '/')

if (invokedDirectly) {
  void main()
}
