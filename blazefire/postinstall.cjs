#!/usr/bin/env node
/**
 * Blazefire auto-activation.
 *
 * Runs after install and wires the activation into the host project's
 * next.config.* for you, so nobody has to hand-edit it:
 *
 *     import blazefire from "blazefire/plugin";
 *     export default blazefire(nextConfig);
 *
 * This file is also the engine behind `npx blazefire init` / `restore`. It
 * only self-executes when invoked directly (require.main), so requiring it
 * from the CLI is inert.
 *
 * Safety rules — a postinstall must never break someone's install:
 *
 *   1. never throws; any failure is logged and swallowed (exit 0)
 *   2. only ever writes a next.config.* found in the project we were
 *      installed INTO, never our own package and never a random ancestor
 *   3. requires Next.js to be resolvable from the project before writing
 *   4. copies the original into "<project>/Blazefire Backup/" first, and
 *      never overwrites an existing backup — the first copy is the pristine
 *      pre-Blazefire original
 *   5. idempotent: if "blazefire/plugin" is already referenced, does nothing
 *   6. opt out entirely with BLAZEFIRE_SKIP_AUTO=1
 *   7. after a successful activation it adds a `postinstall` hook to the
 *      HOST project's package.json, because a package's own postinstall is
 *      exactly what pnpm/bun refuse to run for untrusted dependencies — but
 *      a project's own scripts always run. One `npx blazefire init` (or a
 *      plain npm/yarn install) therefore makes every later pnpm/bun install
 *      self-activate too. `restore` puts the original script back.
 *
 * The edit itself is deliberately dumb: locate the top-level `export default`
 * (or `module.exports`) while skipping strings/comments/braces, then wrap the
 * expression in `blazefire(...)`. Anything we cannot recognise with
 * confidence is left alone and reported as a paste-in snippet instead.
 */
'use strict'

const fs = require('fs')
const { createRequire } = require('module')
const path = require('path')

const CONFIG_NAMES = [
  'next.config.ts',
  'next.config.mts',
  'next.config.cts',
  'next.config.mjs',
  'next.config.js',
  'next.config.cjs',
]

const BACKUP_DIR = 'Blazefire Backup'
const MARKER = 'blazefire/plugin'
const ESM_IMPORT = 'import blazefire from "blazefire/plugin";'
const CJS_REQUIRE = 'const blazefire = require("blazefire/plugin");'

// The hook we write into the HOST project's scripts. Two deliberate choices:
//
//   - `|| echo blazefire skipped` — without it, removing `blazefire` from
//     dependencies leaves this line behind and the next install dies with
//     `sh: 1: blazefire: not found` (exit 127 on npm, 1 on pnpm). A postinstall
//     must never be able to brick a project, so the failure is swallowed.
//   - `&& <theirs>` when a postinstall already exists — `||` binds tighter in
//     effect here (left-associative, equal precedence), so their command runs
//     whether init succeeded or was skipped.
const HOOK_COMMAND = 'blazefire init || echo blazefire skipped'
// Matches our hook (`blazefire init …`, optionally `npx`-ed or version-pinned)
// but not scripts that merely mention blazefire. The old `blazefire\b[\s\S]*init`
// matched anything with the two words in any order anywhere — `blazefire-docs
// init:watch` or `node blazefire.mjs && something init` — which made us treat
// an unrelated script as our own and skip installing the hook.
const HOOK_RE = /(^|[\s;&|])blazefire(?:\s|@[\w.-]+\s)+init\b/
// Written next to the config backup so `restore` can undo it exactly, without
// restoring a whole (now stale) copy of package.json.
const HOOK_RECORD = 'scripts.postinstall.json'

function say(message) {
  try {
    console.log('  blazefire: ' + message)
  } catch (_) {
    /* stdout may be gone; never let logging break the install */
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (_) {
    return null
  }
}

/** Nearest directory at or above `start` that owns a package.json. */
function findNearestPackageRoot(start) {
  let dir = path.resolve(start)
  for (let i = 0; i < 16; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

function findConfig(root) {
  for (const name of CONFIG_NAMES) {
    const file = path.join(root, name)
    try {
      if (fs.statSync(file).isFile()) return file
    } catch (_) {
      /* not here */
    }
  }
  return null
}

function dependencyBags(pkg) {
  return [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]
    .map((key) => pkg && pkg[key])
    .filter(Boolean)
}

function declaresNext(pkg) {
  return dependencyBags(pkg).some((bag) =>
    Object.prototype.hasOwnProperty.call(bag, 'next')
  )
}

function hasInstalledNext(projectRoot) {
  if (fs.existsSync(path.join(projectRoot, 'node_modules', 'next'))) return true

  try {
    createRequire(path.join(projectRoot, 'package.json')).resolve('next')
    return true
  } catch (error) {
    if (
      error &&
      (error.code === 'MODULE_NOT_FOUND' ||
        error.code === 'UNDECLARED_DEPENDENCY')
    ) {
      return false
    }
    throw error
  }
}

/** Only a project that actually depends on us should get the hook. */
function declaresBlazefire(pkg) {
  return dependencyBags(pkg).some((bag) =>
    Object.prototype.hasOwnProperty.call(bag, 'blazefire')
  )
}

/**
 * The manifest is not enough: npm (and yarn) write a newly added dependency
 * into package.json *after* lifecycle scripts run, so on the very first
 * `npm install github:…` we are demonstrably installed but not yet listed.
 * The hook only needs us to be present on disk.
 */
function hasBlazefire(projectRoot, pkg) {
  if (declaresBlazefire(pkg)) return true
  return blazefireInstalledAt(projectRoot)
}

/* ------------------------------------------------------------------ *
 * workspace / monorepo discovery
 *
 * Installing blazefire at the root of a monorepo is the common case, and
 * that root is usually not where the Next app lives — so an installer that
 * only looks at its own package.json silently does nothing. Only *declared*
 * workspaces are considered, so the search stays bounded and predictable.
 * ------------------------------------------------------------------ */

/** Workspace globs from package.json#workspaces and pnpm-workspace.yaml. */
function workspacePatterns(projectRoot) {
  const patterns = []

  const pkg = readJson(path.join(projectRoot, 'package.json'))
  const ws = pkg && pkg.workspaces
  if (Array.isArray(ws)) patterns.push(...ws)
  else if (ws && Array.isArray(ws.packages)) patterns.push(...ws.packages)

  try {
    const yaml = fs.readFileSync(
      path.join(projectRoot, 'pnpm-workspace.yaml'),
      'utf8'
    )
    let collecting = false
    for (const line of yaml.split('\n')) {
      if (/^packages\s*:/.test(line)) {
        collecting = true
        continue
      }
      if (!collecting) continue
      const item = /^\s*-\s*(.+?)\s*$/.exec(line)
      if (item) patterns.push(item[1].replace(/^["']|["']$/g, ''))
      else if (/^\S/.test(line)) collecting = false // next top-level key
    }
  } catch (_) {
    /* not a pnpm workspace */
  }

  return patterns
}

/** Expand the `dir` and `dir/*` shapes real workspace files use. */
function expandWorkspace(projectRoot, patterns) {
  const dirs = []
  for (const pattern of patterns) {
    if (pattern.includes('**')) continue // too open-ended to walk
    const star = pattern.indexOf('*')
    if (star === -1) {
      const dir = path.join(projectRoot, pattern)
      if (fs.existsSync(path.join(dir, 'package.json'))) dirs.push(dir)
      continue
    }
    const parent = path.join(
      projectRoot,
      pattern.slice(0, star).replace(/\/$/, '')
    )
    let entries = []
    try {
      entries = fs.readdirSync(parent, { withFileTypes: true })
    } catch (_) {
      continue
    }
    for (const entry of entries) {
      if (entry.isDirectory()) dirs.push(path.join(parent, entry.name))
    }
  }
  return dirs
}

/** Declared workspaces that actually hold a Next config, in stable order. */
function findWorkspaceProjects(projectRoot) {
  const patterns = workspacePatterns(projectRoot)
  if (!patterns.length) return []
  const dirs = expandWorkspace(projectRoot, patterns)
  dirs.sort()
  return dirs.filter((dir) => findConfig(dir))
}

/**
 * Can this project run `blazefire` at all? Walks up, because a workspace
 * package legitimately resolves a dependency hoisted to the monorepo root.
 */
function blazefireInstalledAt(projectRoot) {
  let dir = path.resolve(projectRoot)
  for (let i = 0; i < 16; i++) {
    if (
      fs.existsSync(path.join(dir, 'node_modules', 'blazefire', 'package.json'))
    )
      return true
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return false
}

/* ------------------------------------------------------------------ *
 * source scanning
 *
 * next.config files are small, so rather than pull in a parser we walk
 * the text once, skipping strings, template literals, comments and
 * brackets, which is enough to find a *top-level* statement safely.
 * ------------------------------------------------------------------ */

/** Return the index just past a string/template literal opened at `i`. */
function skipString(src, i) {
  const quote = src[i]
  i += 1
  while (i < src.length) {
    const c = src[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (quote === '`' && c === '$' && src[i + 1] === '{') {
      let depth = 1
      i += 2
      while (i < src.length && depth > 0) {
        const d = src[i]
        if (d === '{') depth += 1
        else if (d === '}') depth -= 1
        else if (d === '"' || d === "'" || d === '`') {
          i = skipString(src, i)
          continue
        }
        i += 1
      }
      continue
    }
    if (c === quote) return i + 1
    i += 1
  }
  return i
}

/** Find the first top-level occurrence of any target string. */
function findTopLevel(src, targets) {
  let i = 0
  let depth = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '/' && src[i + 1] === '/') {
      const e = src.indexOf('\n', i)
      i = e === -1 ? src.length : e + 1
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2)
      i = e === -1 ? src.length : e + 2
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      i = skipString(src, i)
      continue
    }
    if (c === '{' || c === '(' || c === '[') {
      depth += 1
      i += 1
      continue
    }
    if (c === '}' || c === ')' || c === ']') {
      depth -= 1
      i += 1
      continue
    }
    if (depth === 0) {
      for (const target of targets) {
        if (src.startsWith(target, i)) return { index: i, token: target }
      }
    }
    i += 1
  }
  return null
}

/**
 * Index just past the statement starting at `start`.
 *
 * Two ways to stop, in order of precedence:
 *   1. a depth-0 `;`
 *   2. a newline (at depth 0) followed by a new top-level statement keyword —
 *      automatic-semicolon-insertion ends the statement there. Without this,
 *      a semicolon-less config like
 *          module.exports = cfg
 *          module.exports.env = { FOO: 'bar' }
 *      scanned to EOF and the wrap glued BOTH statements into one call:
 *          blazefire(cfg\nmodule.exports.env = …)   ← syntax error
 */
function statementEnd(src, start) {
  let i = start
  let depth = 0
  // A new statement can only begin where depth is 0 and we are at a line start.
  let atLineStart = true
  while (i < src.length) {
    const c = src[i]
    if (c === '"' || c === "'" || c === '`') {
      i = skipString(src, i)
      atLineStart = false
      continue
    }
    if (c === '/' && src[i + 1] === '/') {
      const e = src.indexOf('\n', i)
      i = e === -1 ? src.length : e + 1
      atLineStart = true
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2)
      i = e === -1 ? src.length : e + 2
      atLineStart = false
      continue
    }
    if (c === '{' || c === '(' || c === '[') {
      depth += 1
      atLineStart = false
    } else if (c === '}' || c === ')' || c === ']') {
      depth -= 1
      atLineStart = false
    } else if (c === ';' && depth <= 0) {
      return i + 1
    } else if (c === '\n') {
      atLineStart = depth <= 0
    } else if (!/\s/.test(c)) {
      // First significant character of a line at depth 0: does a new
      // statement begin here? Only top-level statement starters count —
      // nothing that can legally continue an expression after ASI.
      if (atLineStart && depth <= 0 && startsNewStatement(src, i)) {
        // Return the end of the *previous* line (just past its newline),
        // excluding trailing whitespace.
        let j = i
        while (j > start && /[ \t\r]/.test(src[j - 1])) j -= 1
        return j
      }
      atLineStart = false
    }
    i += 1
  }
  return src.length
}

/**
 * Does the token at `i` begin a new top-level statement?
 *
 * Restricted to unambiguous statement starters — a token that can never
 * continue an expression (`const`, `module.exports`, `export`, `import`, …).
 * Operators that *do* continue an expression (`.`, `?`, `:`, `&&`, `+`, …)
 * are deliberately absent, so a multi-line object/array/chain keeps scanning.
 */
function startsNewStatement(src, i) {
  return (
    /^(module\s*\.|exports\s*\.|export\s|import\s|const\s|let\s|var\s|function\s|class\s|require\s*\(|module\s*\(\))/.test(
      src.slice(i, i + 40)
    )
  )
}

/**
 * Index of the first top-level `//` line comment within src[from..to), or -1.
 *
 * String- and block-comment-aware, depth-tracked: a `//` inside a nested
 * object/array/call or inside a string does not count. Used to keep a
 * trailing comment out of the wrapped expression.
 */
function findTopLevelLineComment(src, from, to) {
  let depth = 0
  let i = from
  const end = Math.min(to, src.length)
  while (i < end) {
    const c = src[i]
    if (c === '"' || c === "'" || c === '`') {
      const s = skipString(src, i)
      i = s === -1 ? i + 1 : s
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2)
      i = e === -1 ? end : e + 2
      continue
    }
    if (c === '/' && src[i + 1] === '/') return i
    if (c === '{' || c === '(' || c === '[') depth += 1
    else if (c === '}' || c === ')' || c === ']') depth = Math.max(0, depth - 1)
    i += 1
  }
  return -1
}

const SNIPPET =
  'import blazefire from "blazefire/plugin";\nexport default blazefire(nextConfig);'

/* ------------------------------------------------------------------ *
 * the actual rewrite
 * ------------------------------------------------------------------ */

/**
 * Is there a *second* top-level default export at or after `from`?
 *
 * `module.exports` on its own is not enough of a signal: `module.exports.env = …`
 * adds a property to the one config rather than declaring another export, and
 * treating it as a duplicate refused perfectly ordinary CJS configs.
 */
function hasAnotherDefaultExport(src, from) {
  let searchFrom = from
  for (;;) {
    const hit = findTopLevel(src.slice(searchFrom), [
      'export default',
      'module.exports',
    ])
    if (!hit) return false

    const at = searchFrom + hit.index
    if (hit.token === 'export default') return true

    // A reassignment (`module.exports = x`) replaces the export; a property
    // assignment (`module.exports.env = x`) does not.
    let i = at + hit.token.length
    while (i < src.length && /[ \t\r\n]/.test(src[i])) i += 1
    if (src[i] === '=' && src[i + 1] !== '=') return true

    // Keep looking past this one — there may be a real reassignment later.
    searchFrom = at + hit.token.length
  }
}

function plan(src) {
  const hit = findTopLevel(src, ['export default', 'module.exports'])
  if (!hit) return { ok: false, reason: 'no top-level `export default` found' }

  const isEsm = hit.token === 'export default'
  const headEnd = hit.index + hit.token.length
  const rest = src.slice(headEnd)

  // Two default exports (the exact mistake this tool exists to fix) must not
  // be "repaired" by wrapping only the first — refuse and explain instead.
  if (hasAnotherDefaultExport(src, headEnd)) {
    return {
      ok: false,
      reason: 'file declares a default export more than once',
    }
  }

  // Function-style configs are fine: blazefire() detects a function argument
  // and wraps the config it returns, so Next still gets its (phase, ctx) call.
  // A `class` is not a config shape at all — refuse rather than guess.
  if (isEsm && /^\s+class\b/.test(rest)) {
    return { ok: false, reason: '`export default class` is not a Next config' }
  }
  if (
    /^\s*\{?[^;]*\bas\s+default\b/.test(
      src.slice(Math.max(0, hit.index - 120), headEnd)
    )
  ) {
    return { ok: false, reason: '`export { x as default }` form not supported' }
  }

  // Skip past `export default` / `module.exports` and any `=` / `satisfies` glue
  // to the start of the expression itself.
  let exprStart = headEnd
  while (exprStart < src.length && /[ \t\r\n=]/.test(src[exprStart]))
    exprStart += 1

  const endOfStatement = statementEnd(src, exprStart)
  // statementEnd returns either just past a depth-0 `;` or the end of file,
  // so the byte before it tells us which — scanning raw text for ';' would
  // misfire on a `;` nested inside a function body.
  const semicolon = endOfStatement > 0 && src[endOfStatement - 1] === ';'

  let expression
  let exprEnd
  if (semicolon) {
    expression = src.slice(exprStart, endOfStatement - 1).trim()
    exprEnd = endOfStatement // the `;` is re-emitted by the replacement
  } else {
    const raw = src.slice(exprStart, endOfStatement)
    let trimmed = raw.trimEnd()
    // A trailing `//` comment must not swallow the closing `)` of the wrap
    // (`module.exports = nextConfig // note` → `blazefire(nextConfig // note)`
    // is a hard syntax error). Cut the expression before the comment; the
    // comment stays in the tail after the call. If real code follows the
    // comment's line the shape is too uncertain to rewrite — refuse instead.
    const commentAt = findTopLevelLineComment(
      src,
      exprStart,
      exprStart + trimmed.length
    )
    if (commentAt !== -1) {
      const afterCut = src.slice(commentAt, exprStart + trimmed.length)
      const eolIdx = afterCut.indexOf('\n')
      if (eolIdx !== -1 && afterCut.slice(eolIdx).trim() !== '') {
        return {
          ok: false,
          reason: 'trailing line comment is followed by more code',
        }
      }
      trimmed = src.slice(exprStart, commentAt).trimEnd()
    }
    // Stop before trailing whitespace so blank lines / final newline stay in
    // the tail instead of being swallowed by the wrapped call.
    expression = trimmed.trim()
    exprEnd = exprStart + trimmed.length
  }

  if (!expression)
    return { ok: false, reason: 'could not locate the config expression' }

  // `mid` (the slice from insertAt up to exprStart) already carries the
  // `export default` / `module.exports =` keyword verbatim, so the replacement
  // must be ONLY the call — re-emitting the keyword here doubles it and emits
  // `export default export default ...`, a hard syntax error.
  const replacement = `blazefire(${expression})${semicolon ? ';' : ''}`

  const firstImport = findTopLevel(src, ['import '])
  let insertAt = firstImport ? firstImport.index : hit.index
  if (insertAt > hit.index) insertAt = hit.index
  if (src.startsWith('#!')) {
    const nl = src.indexOf('\n')
    if (nl !== -1 && nl < insertAt) insertAt = nl + 1
  }

  return {
    ok: true,
    isEsm,
    insertAt,
    exprStart,
    exprEnd,
    replacement,
    line: isEsm ? ESM_IMPORT : CJS_REQUIRE,
  }
}

function rewrite(src) {
  const p = plan(src)
  if (!p.ok) return p

  // Respect the file's own line endings, otherwise a Windows-authored config
  // ends up with one LF line in a CRLF document.
  const eol = src.includes('\r\n') ? '\r\n' : '\n'

  const head = src.slice(0, p.insertAt)
  const mid = src.slice(p.insertAt, p.exprStart)
  const tail = src.slice(p.exprEnd)
  return { ok: true, code: head + p.line + eol + mid + p.replacement + tail }
}

/* ------------------------------------------------------------------ *
 * driver
 * ------------------------------------------------------------------ */

function backup(originalFile, contents, projectRoot) {
  const backupRoot = path.join(projectRoot, BACKUP_DIR)
  const saved = path.join(backupRoot, path.basename(originalFile))
  fs.mkdirSync(backupRoot, { recursive: true })
  // First copy wins: it is the pristine pre-Blazefire original.
  if (!fs.existsSync(saved)) fs.writeFileSync(saved, contents, 'utf8')
  return saved
}

const GITIGNORE_NOTE_HEADER =
  '# Blazefire keeps a copy of the config it edits'

function noteGitignore(projectRoot) {
  const file = path.join(projectRoot, '.gitignore')
  try {
    let current = ''
    try {
      current = fs.readFileSync(file, 'utf8')
    } catch (_) {
      current = '' // none yet — creating it is the entire point of this
    }
    if (current.includes(BACKUP_DIR)) return
    const note = GITIGNORE_NOTE_HEADER + '\n' + BACKUP_DIR + '/\n'
    const body =
      current === ''
        ? note
        : (current.endsWith('\n') ? current : current + '\n') + '\n' + note
    fs.writeFileSync(file, body, 'utf8')
  } catch (_) {
    /* cosmetic only */
  }
}

/**
 * Remove the two-line note noteGitignore() appends — and the blank-line
 * separator that preceded it. Without this, `restore` put the config back
 * but left `.gitignore` permanently edited. Only the exact block we write is
 * touched, and a `.gitignore` that ends up empty is left in place (we cannot
 * prove we created it).
 */
function stripGitignoreNote(projectRoot) {
  const file = path.join(projectRoot, '.gitignore')
  let current
  try {
    current = fs.readFileSync(file, 'utf8')
  } catch (_) {
    return
  }
  if (!current.includes(GITIGNORE_NOTE_HEADER)) return
  const block = GITIGNORE_NOTE_HEADER + '\n' + BACKUP_DIR + '/\n'
  let next = current.replace(block, '')
  if (next === current) return
  // Undo exactly the one separator newline noteGitignore inserted.
  if (next.endsWith('\n\n')) next = next.slice(0, -2) + '\n'
  try {
    fs.writeFileSync(file, next, 'utf8')
  } catch (_) {
    /* cosmetic only */
  }
}

/* ------------------------------------------------------------------ *
 * the self-perpetuating hook
 *
 * A dependency's own postinstall is exactly what pnpm and bun withhold from
 * an untrusted package, but the *project's* own scripts always run. So a
 * successful activation records itself into the host package.json, which
 * turns "npm/yarn activate, pnpm/bun do not" into "everything activates".
 * ------------------------------------------------------------------ */

/** Write package.json back with its own indentation and trailing newline. */
function writeJsonPreserving(file, pkg) {
  let raw = ''
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (_) {
    /* about to be overwritten anyway */
  }
  const indent = (raw.match(/^([ \t]+)"/m) || [])[1] || 2
  const trailing = raw === '' || raw.endsWith('\n') ? '\n' : ''
  fs.writeFileSync(file, JSON.stringify(pkg, null, indent) + trailing, 'utf8')
}

/**
 * True only when this process is the host project's own `postinstall` — i.e.
 * launched by the hook we wrote, not typed by a person.
 *
 * All four managers set `npm_lifecycle_event=postinstall` for a project
 * script (verified), while a typed invocation never does: `npx`/`pnpm exec`
 * set it to "npx", a direct node_modules/.bin call leaves it undefined. The
 * second condition — that the script really is ours — stops an unrelated
 * postinstall from inheriting our leniency.
 */
function isLifecycleHook() {
  if (process.env.npm_lifecycle_event !== 'postinstall') return false
  const located = locateCandidates()
  for (const start of located.candidates) {
    const root = findNearestPackageRoot(start)
    if (!root || (located.ownRoot && root === located.ownRoot)) continue
    const pkg = readJson(path.join(root, 'package.json'))
    const script = pkg && pkg.scripts && pkg.scripts.postinstall
    if (typeof script === 'string' && HOOK_RE.test(script)) return true
  }
  return false
}

/**
 * Add the activation hook to the host package.json, idempotently.
 *
 * Never overwrites an existing postinstall — it is chained after ours — and
 * records the pristine original beside the config backup so `restore` can
 * put it back exactly rather than restoring a whole stale package.json.
 *
 * @returns {boolean} whether anything was written
 */
/**
 * Install the self-activation hook in the project that owns the config, and in
 * the install root when those differ.
 *
 * In a monorepo the lifecycle actually runs at the root: that is where
 * `npm install` / `yarn` execute scripts and where the blazefire dependency is
 * declared. A hook left only in a workspace child is dead in a very common
 * layout — a root that declares `pnpm-workspace.yaml` but no
 * `package.json#workspaces` is invisible to yarn and npm, so they never run the
 * child's script and "self-activating" would silently not be true.
 */
function hookBoth(configRoot, installRoot) {
  const wrote = ensureHook(configRoot)
  if (installRoot && installRoot !== configRoot) ensureHook(installRoot)
  return wrote
}

function ensureHook(projectRoot) {
  // Writing a hook under an explicit opt-out would defeat the opt-out on the
  // very next install, so skip it entirely.
  if (process.env.BLAZEFIRE_SKIP_AUTO) return false

  const file = path.join(projectRoot, 'package.json')
  const pkg = readJson(file)
  if (!pkg) return false
  if (!hasBlazefire(projectRoot, pkg)) return false

  const scripts = pkg.scripts || {}
  const existing = scripts.postinstall
  if (typeof existing === 'string' && HOOK_RE.test(existing)) return false // already ours

  const record = path.join(projectRoot, BACKUP_DIR, HOOK_RECORD)
  try {
    if (!fs.existsSync(record)) {
      fs.mkdirSync(path.join(projectRoot, BACKUP_DIR), { recursive: true })
      fs.writeFileSync(
        record,
        JSON.stringify(
          {
            existed: typeof existing === 'string',
            value: typeof existing === 'string' ? existing : null,
          },
          null,
          2
        ) + '\n',
        'utf8'
      )
    }
  } catch (_) {
    // The record is what makes this reversible; without it, do not touch.
    return false
  }

  pkg.scripts = scripts
  scripts.postinstall = existing
    ? HOOK_COMMAND + ' && ' + existing
    : HOOK_COMMAND
  writeJsonPreserving(file, pkg)
  say(
    'added "postinstall": ' +
      JSON.stringify(scripts.postinstall) +
      ' — future installs will self-activate'
  )
  return true
}

/** Undo {@link ensureHook}. @returns {boolean} whether there was a record */
function undoHook(projectRoot) {
  const record = path.join(projectRoot, BACKUP_DIR, HOOK_RECORD)
  const saved = readJson(record)
  if (!saved) return false

  const file = path.join(projectRoot, 'package.json')
  const pkg = readJson(file)
  const scripts = pkg && pkg.scripts
  const current = scripts && scripts.postinstall

  // Only ever touch a script that is recognisably ours. If the user removed or
  // replaced it there is nothing to undo, so report "did nothing" and KEEP the
  // record: it still holds their pre-Blazefire value, and the only copy of it.
  // Unlinking it here used to claim a restore that never happened, which made
  // `restore` exit 0 having restored nothing.
  if (typeof current !== 'string' || !HOOK_RE.test(current)) return false

  if (saved.existed) scripts.postinstall = saved.value
  else delete scripts.postinstall
  writeJsonPreserving(file, pkg)
  say(
    'restored "scripts.postinstall"' +
      (saved.existed ? '' : ' (removed the Blazefire hook)')
  )

  try {
    fs.unlinkSync(record)
  } catch (_) {
    /* already gone */
  }
  return true
}

function activate(projectRoot, configPath, original) {
  const result = rewrite(original)
  if (!result.ok) {
    say(
      'could not auto-edit ' +
        path.basename(configPath) +
        ' (' +
        result.reason +
        ').'
    )
    say('paste this in manually instead:')
    say(SNIPPET.split('\n').join('\n         '))
    return
  }

  const saved = backup(configPath, original, projectRoot)
  writeAtomicSync(configPath, result.code)
  noteGitignore(projectRoot)

  say(
    'activated ' +
      path.basename(configPath) +
      ' — original saved to ' +
      path.relative(projectRoot, saved).split(path.sep).join('/')
  )
}

/**
 * Replace `file` atomically: write a sibling temp file, then rename it over
 * the target. A plain writeFileSync can leave the user's config truncated if
 * the process dies mid-write — and the config is the one file an interrupted
 * `npm install` must never be allowed to corrupt.
 */
function writeAtomicSync(file, contents) {
  const tmp =
    file + '.blazefire-tmp-' + process.pid + '-' + Math.random().toString(36).slice(2)
  fs.writeFileSync(tmp, contents, 'utf8')
  try {
    fs.renameSync(tmp, file)
  } catch (err) {
    // Windows can refuse rename-over-existing in edge cases: fall back to a
    // direct write rather than leaving a stray temp file as the only copy.
    try {
      fs.unlinkSync(tmp)
    } catch (_) {
      /* best effort */
    }
    fs.writeFileSync(file, contents, 'utf8')
  }
}

function locateCandidates() {
  // Our own package root: the nearest package.json above this file. A
  // candidate may never resolve back to it, so we can never edit ourselves.
  // It can legitimately be null (e.g. running cli.cjs straight from a
  // temp dir), in which case cwd alone decides.
  const ownRoot = findNearestPackageRoot(__dirname)

  // __dirname alone is not trustworthy: with a symlinked `file:` install node
  // resolves to the real package path, which can sit anywhere. npm/yarn both
  // publish where the install was started (INIT_CWD), npm publishes the
  // install root, and cwd is what yarn uses for lifecycle scripts — and what
  // `npx blazefire init` runs from.
  const candidates = [
    process.env.INIT_CWD,
    process.env.npm_config_local_prefix,
    process.cwd(),
    ownRoot && path.dirname(ownRoot),
  ].filter(Boolean)

  return { ownRoot, candidates }
}

/**
 * Wire the activation into the nearest recognised project.
 *
 * @param {{cli?: boolean}} [opts] `cli` reports every outcome and relaxes the
 *   installed-next guard — a user typing `npx blazefire init` has said what
 *   they want, so a declared-but-not-yet-installed `next` is enough.
 * @returns {'activated'|'already'|'manual'|'not-found'} outcome for callers
 *   that need an exit code. The postinstall path deliberately ignores it and
 *   always exits 0.
 */
function run(opts) {
  const cli = !!(opts && opts.cli)
  // Opt-out covers both paths: the plain postinstall, and the hook (which is
  // a CLI invocation but still "auto", so honouring it here is what keeps
  // BLAZEFIRE_SKIP_AUTO=1 true for the life of the project).
  if (process.env.BLAZEFIRE_SKIP_AUTO && (!cli || isLifecycleHook()))
    return 'not-found'

  const located = locateCandidates()
  const { ownRoot, candidates } = located

  const seen = new Set()
  let sawConfig = null
  let declaredNext = false

  for (const start of candidates) {
    const projectRoot = findNearestPackageRoot(start)
    if (
      !projectRoot ||
      (ownRoot && projectRoot === ownRoot) ||
      seen.has(projectRoot)
    )
      continue
    seen.add(projectRoot)

    // The project holding the Next config is often a workspace *child*: an
    // installer run at a monorepo root almost never has the app beside it.
    const roots = [projectRoot].concat(
      findWorkspaceProjects(projectRoot).filter((dir) => !seen.has(dir))
    )

    for (const root of roots) {
      seen.add(root)

      const pkg = readJson(path.join(root, 'package.json'))
      const configPath = findConfig(root)
      if (configPath && !sawConfig)
        sawConfig = { projectRoot: root, installRoot: projectRoot, configPath }

      if (declaresNext(pkg)) declaredNext = true
      if (!configPath) continue

      const original = fs.readFileSync(configPath, 'utf8')
      // The marker alone is not proof of wiring: a comment or dead code can
      // mention `blazefire/plugin` without ever calling it. Require both the
      // marker and an actual call, matching the shape rewrite() emits.
      if (original.includes(MARKER) && /(?:^|[^\w$.])blazefire\s*\(/.test(original)) {
        // Already wired, but the hook may not be: the config could have been
        // activated by our own postinstall on an earlier npm/yarn install.
        hookBoth(root, projectRoot)
        if (cli)
          say('already active — ' + path.basename(configPath) + ' is wired up.')
        return 'already'
      }

      // Only ever write where `next` is genuinely installed. Resolution runs
      // through the project's own dependency context, so a hoisted workspace
      // (npm/yarn put `next` at the repo root) and Yarn Plug'n'Play both work
      // — the exact layout `findWorkspaceProjects` exists to serve.
      const hasNext = hasInstalledNext(root)
      if (!hasNext && !(cli && declaresNext(pkg))) continue

      activate(root, configPath, original)
      hookBoth(root, projectRoot)
      return 'activated'
    }
  }

  // The config is there but `next` is not installed yet — almost always an
  // install that simply hasn't run. Activation has to wait, but the *hook*
  // does not: this run arrived first, so wiring it here is what lets the next
  // install (the one that brings `next`) finish the job by itself instead of
  // asking the user to run anything by hand.
  if (sawConfig) {
    hookBoth(sawConfig.projectRoot, sawConfig.installRoot)
    say(
      'found ' +
        path.basename(sawConfig.configPath) +
        ' but Next.js is not installed — skipped.'
    )
    say(
      'the next install will activate it automatically, or run: npx blazefire init'
    )
    return 'manual'
  }
  if (declaredNext) {
    say(
      'this looks like a Next.js project but there is no next.config.* — add:'
    )
    say(SNIPPET.split('\n').join('\n         '))
    return 'manual'
  }
  if (cli) {
    say(
      'no next.config.* found from ' +
        process.cwd() +
        ' — run this in your project root, or add:'
    )
    say(SNIPPET.split('\n').join('\n         '))
  }
  return 'not-found'
}

/**
 * Undo activation by copying `Blazefire Backup/` back over the config.
 *
 * @returns {number} process exit code
 */
function restore() {
  const located = locateCandidates()
  if (!located) return 1
  const { ownRoot, candidates } = located

  const seen = new Set()
  for (const start of candidates) {
    const projectRoot = findNearestPackageRoot(start)
    if (!projectRoot || projectRoot === ownRoot || seen.has(projectRoot))
      continue
    seen.add(projectRoot)

    // Same workspace descent as run(): a backup written into a workspace
    // child has to be reachable from the monorepo root too.
    const roots = [projectRoot].concat(
      findWorkspaceProjects(projectRoot).filter((dir) => !seen.has(dir))
    )

    let restored = 0
    for (const root of roots) {
      seen.add(root)

      const backupRoot = path.join(root, BACKUP_DIR)
      if (fs.existsSync(backupRoot)) {
        for (const name of CONFIG_NAMES) {
          const saved = path.join(backupRoot, name)
          if (!fs.existsSync(saved)) continue
          fs.copyFileSync(saved, path.join(root, name))
          say('restored ' + name + ' from ' + BACKUP_DIR + '/')
          restored += 1
          // The backup has served its purpose — consume it. Keeping it meant
          // every later `restore` re-copied a stale original over whatever the
          // user had written since, and a following `init` skipped writing a
          // fresh backup ("the first copy wins"), silently losing edits.
          try {
            fs.unlinkSync(saved)
          } catch (_) {
            /* best effort — a leftover file is restored again next time */
          }
        }
      } else if (root !== projectRoot) {
        continue // a workspace child with no backup holds nothing of ours
      }

      // The hook is part of "what Blazefire changed" — leaving it behind would
      // re-activate the config on the next install. The install root gets one
      // even though its backup lives in the child, so undo it regardless of
      // whether this particular root holds a backup directory.
      if (undoHook(root)) restored += 1

      // The .gitignore note rode along with activation — take it back too.
      const giFile = path.join(root, '.gitignore')
      let giBefore = null
      try {
        giBefore = fs.readFileSync(giFile, 'utf8')
      } catch (_) {
        /* absent — nothing to strip */
      }
      if (giBefore !== null) {
        stripGitignoreNote(root)
        let giAfter = giBefore
        try {
          giAfter = fs.readFileSync(giFile, 'utf8')
        } catch (_) {
          /* unchanged */
        }
        if (giAfter !== giBefore) restored += 1
      }

      // Drop the backup directory once it is empty, so a second `restore`
      // correctly reports "nothing to restore" instead of a phantom success.
      try {
        if (
          fs.existsSync(backupRoot) &&
          fs.readdirSync(backupRoot).length === 0
        ) {
          fs.rmdirSync(backupRoot)
        }
      } catch (_) {
        /* best effort */
      }
    }
    if (restored > 0) return 0
  }

  say('no backups in ' + BACKUP_DIR + '/ — nothing to restore.')
  return 1
}

if (require.main === module) {
  try {
    run()
  } catch (error) {
    // A postinstall must never fail someone's install — and an error thrown
    // in a `finally` would escape this handler and abort it, so there isn't one.
    say(
      'auto-activation skipped: ' +
        (error && error.message ? error.message : error)
    )
    process.exitCode = 0
  }
}

module.exports = {
  run,
  restore,
  plan,
  rewrite,
  findConfig,
  isLifecycleHook,
  ensureHook,
  undoHook,
  SNIPPET,
  BACKUP_DIR,
  MARKER,
  HOOK_COMMAND,
}
