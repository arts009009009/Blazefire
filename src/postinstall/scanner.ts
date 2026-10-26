/**
 * Config-source scanner — the pure text engine behind activation.
 *
 * Ported 1:1 from v1 blazefire/postinstall.cjs (the comment/string/regex/
 * bracket-aware walker). next.config files are small, so rather than pull in
 * a parser we walk the text once, which is enough to find a *top-level*
 * statement safely. Everything here is pure: no fs, no process, trivially
 * testable.
 */

export const ESM_IMPORT = 'import blazefire from "blazefire/plugin";'
export const CJS_REQUIRE = 'const blazefire = require("blazefire/plugin");'

export const SNIPPET =
  'import blazefire from "blazefire/plugin";\nexport default blazefire(nextConfig);'

/** Return the index just past a string/template literal opened at `i`. */
function skipString(src: string, i: number): number {
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

const REGEX_PREFIX_KEYWORDS = new Set([
  'await',
  'case',
  'default',
  'delete',
  'do',
  'else',
  'in',
  'instanceof',
  'of',
  'return',
  'throw',
  'typeof',
  'void',
  'yield',
])

/** Does a slash at `i` start a regex literal rather than division? */
function startsRegexLiteral(src: string, i: number): boolean {
  let previous = i - 1
  while (previous >= 0 && /\s/.test(src[previous]!)) previous -= 1
  if (previous < 0) return true

  const char = src[previous]!
  if ('([{,:;=!?&|+-*%^~<>'.includes(char)) return true
  if (!/[A-Za-z0-9_$]/.test(char)) return false

  let start = previous
  while (start > 0 && /[A-Za-z0-9_$]/.test(src[start - 1]!)) start -= 1
  return REGEX_PREFIX_KEYWORDS.has(src.slice(start, previous + 1))
}

/** Return the index just past a regex literal opened at `i`. */
function skipRegexLiteral(src: string, i: number): number {
  i += 1
  let inCharacterClass = false
  while (i < src.length) {
    const char = src[i]!
    if (char === '\\') {
      i += 2
      continue
    }
    if (char === '\n' || char === '\r') return i
    if (char === '[') inCharacterClass = true
    else if (char === ']') inCharacterClass = false
    else if (char === '/' && !inCharacterClass) {
      i += 1
      while (/[A-Za-z]/.test(src[i] ?? '')) i += 1
      return i
    }
    i += 1
  }
  return i
}

/** Find the first top-level occurrence of any target string. */
export function findTopLevel(
  src: string,
  targets: string[]
): { index: number; token: string } | null {
  let i = 0
  let depth = 0
  while (i < src.length) {
    const c = src[i]!
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
    if (c === '/' && startsRegexLiteral(src, i)) {
      i = skipRegexLiteral(src, i)
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
 * Does the token at `i` begin a new top-level statement?
 *
 * Restricted to unambiguous statement starters — a token that can never
 * continue an expression. Operators that *do* continue an expression (`.`,
 * `?`, `:`, `&&`, `+`, …) are deliberately absent.
 */
function startsNewStatement(src: string, i: number): boolean {
  return /^(module\s*\.|exports\s*\.|export\s|import\s|const\s|let\s|var\s|function\s|class\s|require\s*\(|module\s*\(\))/.test(
    src.slice(i, i + 40)
  )
}

/**
 * Index just past the statement starting at `start`: a depth-0 `;`, or a
 * newline followed by a new top-level statement keyword (ASI).
 */
function statementEnd(src: string, start: number): number {
  let i = start
  let depth = 0
  let atLineStart = true
  while (i < src.length) {
    const c = src[i]!
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
    if (c === '/' && startsRegexLiteral(src, i)) {
      i = skipRegexLiteral(src, i)
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
      if (atLineStart && depth <= 0 && startsNewStatement(src, i)) {
        let j = i
        while (j > start && /[ \t\r]/.test(src[j - 1]!)) j -= 1
        return j
      }
      atLineStart = false
    }
    i += 1
  }
  return src.length
}

/** Index of the first top-level `//` line comment in src[from..to), or -1. */
function findTopLevelLineComment(src: string, from: number, to: number): number {
  let depth = 0
  let i = from
  const end = Math.min(to, src.length)
  while (i < end) {
    const c = src[i]!
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
    if (c === '/' && startsRegexLiteral(src, i)) {
      i = skipRegexLiteral(src, i)
      continue
    }
    if (c === '/' && src[i + 1] === '/') {
      if (depth === 0) return i
      const e = src.indexOf('\n', i)
      i = e === -1 ? end : e + 1
      continue
    }
    if (c === '{' || c === '(' || c === '[') depth += 1
    else if (c === '}' || c === ')' || c === ']') depth = Math.max(0, depth - 1)
    i += 1
  }
  return -1
}

/** Identifier-continuation check — a word-boundary guard for matched targets. */
function isIdentifierChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_$]/.test(ch)
}

/**
 * The top-level statement plan() should wrap, skipping look-alikes that match
 * a target only as a PREFIX:
 *
 *   `export defaultConfig`    — a named export, not a default one
 *   `module.exports.env = …`  — a property assignment, not the config export
 *
 * Property assignments are skipped (rather than refused) so a later real
 * `module.exports = …` is still found.
 */
function findDefaultExport(src: string): { index: number; token: string } | null {
  let searchFrom = 0
  for (;;) {
    const hit = findTopLevel(src.slice(searchFrom), ['export default', 'module.exports'])
    if (!hit) return null

    const at = searchFrom + hit.index
    const after = at + hit.token.length
    if (hit.token === 'export default') {
      if (!isIdentifierChar(src[after])) return { index: at, token: hit.token }
      searchFrom = after // e.g. `export defaultConfig` — keep looking
      continue
    }
    let i = after
    while (i < src.length && /[ \t\r\n]/.test(src[i]!)) i += 1
    if (src[i] === '=' && src[i + 1] !== '=') return { index: at, token: hit.token }
    searchFrom = after
  }
}

/**
 * Is there a *second* top-level default export at or after `from`?
 * A property assignment (`module.exports.env = …`) is not a reassignment.
 */
function hasAnotherDefaultExport(src: string, from: number): boolean {
  return findDefaultExport(src.slice(from)) !== null
}

/**
 * Every shape that DECLARES the top-level identifier `blazefire` (spacing
 * variants included — `import blazefire`, `import * as blazefire`,
 * `import { blazefire`, `const blazefire`, destructured CJS, …).
 */
const BLAZEFIRE_BINDING_TARGETS = [
  'import blazefire',
  'import * as blazefire',
  'import*as blazefire',
  'import { blazefire',
  'import {blazefire',
  'import{ blazefire',
  'import{blazefire',
  'const blazefire',
  'let blazefire',
  'var blazefire',
  'const { blazefire',
  'const {blazefire',
  'const{ blazefire',
  'const{blazefire',
  'let { blazefire',
  'let {blazefire',
  'let{ blazefire',
  'let{blazefire',
  'var { blazefire',
  'var {blazefire',
  'var{ blazefire',
  'var{blazefire',
]

/**
 * Does this file already DECLARE `blazefire` at the top level? If so the
 * import must NOT be injected again — a duplicate binding is a SyntaxError
 * that would break the project on its very next boot. This is reachable
 * through our own advice: the manual SNIPPET tells people to paste the import
 * first, and a half-followed paste leaves exactly this state.
 * Nested declarations are deliberately invisible (they cannot collide with a
 * top-level import).
 */
function hasExistingBinding(src: string): boolean {
  let searchFrom = 0
  for (;;) {
    const hit = findTopLevel(src.slice(searchFrom), BLAZEFIRE_BINDING_TARGETS)
    if (!hit) return false
    const after = searchFrom + hit.index + hit.token.length
    if (!isIdentifierChar(src[after])) return true
    searchFrom = after
  }
}

export type ActivationPlan =
  | { ok: false; reason: string }
  | {
      ok: true
      isEsm: boolean
      /** False when the config already declares `blazefire` (never double-declare). */
      needsImport: boolean
      insertAt: number
      exprStart: number
      exprEnd: number
      replacement: string
      line: string
    }

export function plan(src: string): ActivationPlan {
  const hit = findDefaultExport(src)
  if (!hit) return { ok: false, reason: 'no top-level `export default` found' }

  const isEsm = hit.token === 'export default'
  const headEnd = hit.index + hit.token.length
  const rest = src.slice(headEnd)

  if (hasAnotherDefaultExport(src, headEnd)) {
    return { ok: false, reason: 'file declares a default export more than once' }
  }

  // Function-style configs are fine (blazefire() wraps the config a function
  // returns). A `class` is not a config shape at all — refuse rather than guess.
  if (isEsm && /^\s+class\b/.test(rest)) {
    return { ok: false, reason: '`export default class` is not a Next config' }
  }
  if (/^\s*\{?[^;]*\bas\s+default\b/.test(src.slice(Math.max(0, hit.index - 120), headEnd))) {
    return { ok: false, reason: '`export { x as default }` form not supported' }
  }

  let exprStart = headEnd
  while (exprStart < src.length && /[ \t\r\n=]/.test(src[exprStart]!)) exprStart += 1

  const endOfStatement = statementEnd(src, exprStart)
  const semicolon = endOfStatement > 0 && src[endOfStatement - 1] === ';'

  let expression: string
  let exprEnd: number
  if (semicolon) {
    expression = src.slice(exprStart, endOfStatement - 1).trim()
    exprEnd = endOfStatement
  } else {
    const raw = src.slice(exprStart, endOfStatement)
    let trimmed = raw.trimEnd()
    // A trailing `//` comment must not swallow the closing `)` of the wrap.
    const commentAt = findTopLevelLineComment(src, exprStart, exprStart + trimmed.length)
    if (commentAt !== -1) {
      const afterCut = src.slice(commentAt, exprStart + trimmed.length)
      const eolIdx = afterCut.indexOf('\n')
      if (eolIdx !== -1 && afterCut.slice(eolIdx).trim() !== '') {
        return { ok: false, reason: 'trailing line comment is followed by more code' }
      }
      trimmed = src.slice(exprStart, commentAt).trimEnd()
    }
    expression = trimmed.trim()
    exprEnd = exprStart + trimmed.length
  }

  if (!expression) return { ok: false, reason: 'could not locate the config expression' }

  // Idempotency at the engine level: an already-wrapped config is refused,
  // so a second activation can never produce blazefire(bnazefire(...)).
  if (/^blazefire\s*\(/.test(expression)) {
    return { ok: false, reason: 'config is already wrapped in blazefire()' }
  }

  // A manual `blazefire(...)` call BEFORE the export means the wrapper was
  // already applied (possibly stored in an intermediate const) — wrapping the
  // reference again would double-inject headers and turbopack rules at
  // runtime. (Depth-0 only: strings, comments and nested bodies don't count.)
  const preWrap = findTopLevel(src.slice(0, exprStart), ['blazefire(', 'blazefire ('])
  if (preWrap && (preWrap.index === 0 || !isIdentifierChar(src[preWrap.index - 1]))) {
    return { ok: false, reason: 'config is already wrapped in blazefire()' }
  }

  // An existing top-level declaration of `blazefire` means the import line
  // must not be injected a second time (duplicate binding = SyntaxError).
  const needsImport = !hasExistingBinding(src)

  // `mid` already carries the `export default` / `module.exports =` keyword
  // verbatim, so the replacement is ONLY the call.
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
    needsImport,
    insertAt,
    exprStart,
    exprEnd,
    replacement,
    line: isEsm ? ESM_IMPORT : CJS_REQUIRE,
  }
}

export type RewriteResult =
  | { ok: false; reason: string }
  | { ok: true; code: string }

export function rewrite(src: string): RewriteResult {
  const p = plan(src)
  if (!p.ok) return p

  // Respect the file's own line endings.
  const eol = src.includes('\r\n') ? '\r\n' : '\n'

  const head = src.slice(0, p.insertAt)
  const mid = src.slice(p.insertAt, p.exprStart)
  const tail = src.slice(p.exprEnd)
  // Only declare the import when the file doesn't already carry it.
  const declaration = p.needsImport ? `${p.line}${eol}` : ''
  return { ok: true, code: head + declaration + mid + p.replacement + tail }
}
