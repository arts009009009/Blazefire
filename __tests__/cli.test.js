/**
 * Tests for the `blazefire` CLI entry (`blazefire/cli.cjs`).
 *
 * The CLI is exercised as a real child process — that is the only way to
 * cover argv parsing, exit codes and stdout/stderr routing honestly.
 * Everything here is offline and side-effect free: `--version`, `--help`
 * and an unknown command touch neither the network nor the filesystem.
 */

'use strict'

const { execFileSync } = require('child_process')
const path = require('path')

const CLI = path.join(__dirname, '..', 'blazefire', 'cli.cjs')
const VERSION = require('../package.json').version

/** Run the CLI with the given argv, never throwing on non-zero exits. */
function run(args) {
  try {
    return {
      status: 0,
      stdout: execFileSync('node', [CLI].concat(args), { encoding: 'utf8' }),
      stderr: '',
    }
  } catch (error) {
    return {
      status: error.status,
      stdout: error.stdout || '',
      stderr: error.stderr || '',
    }
  }
}

describe('blazefire CLI version reporting', () => {
  test.each([['--version'], ['-v'], ['version']])(
    'blazefire %s prints the installed version',
    (arg) => {
      const { status, stdout } = run([arg])
      expect(status).toBe(0)
      expect(stdout.trim()).toBe('blazefire v' + VERSION)
    }
  )

  test('an unknown command fails and names the installed version', () => {
    const { status, stderr } = run(['frobnicate'])
    expect(status).toBe(1)
    expect(stderr).toContain('unknown command "frobnicate"')
    // Naming the version turns "this command does not exist" into the far
    // more useful "my installed copy predates this command".
    expect(stderr).toContain('v' + VERSION)
  })

  test('--help lists every command including --version', () => {
    const { status, stdout } = run(['--help'])
    expect(status).toBe(0)
    for (const command of [
      'npx blazefire init',
      'npx blazefire restore',
      'npx blazefire update',
      'npx blazefire check',
      'npx blazefire --version',
    ]) {
      expect(stdout).toContain(command)
    }
  })
})
