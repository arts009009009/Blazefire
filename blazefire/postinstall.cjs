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
 *   3. requires <project>/node_modules/next to exist before writing
 *   4. copies the original into "<project>/Blazefire Backup/" first, and
 *      never overwrites an existing backup — the first copy is the pristine
 *      pre-Blazefire original
 *   5. idempotent: if "blazefire/plugin" is already referenced, does nothing
 *   6. opt out entirely with BLAZEFIRE_SKIP_AUTO=1
 *
 * The edit itself is deliberately dumb: locate the top-level `export default`
 * (or `module.exports`) while skipping strings/comments/braces, then wrap the
 * expression in `blazefire(...)`. Anything we cannot recognise with
 * confidence is left alone and reported as a paste-in snippet instead.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const CONFIG_NAMES = [
  "next.config.ts",
  "next.config.mts",
  "next.config.cts",
  "next.config.mjs",
  "next.config.js",
  "next.config.cjs",
];

const BACKUP_DIR = "Blazefire Backup";
const MARKER = "blazefire/plugin";
const ESM_IMPORT = 'import blazefire from "blazefire/plugin";';
const CJS_REQUIRE = 'const blazefire = require("blazefire/plugin");';

function say(message) {
  try {
    console.log("  blazefire: " + message);
  } catch (_) {
    /* stdout may be gone; never let logging break the install */
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return null;
  }
}

/** Nearest directory at or above `start` that owns a package.json. */
function findNearestPackageRoot(start) {
  let dir = path.resolve(start);
  for (let i = 0; i < 16; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function findConfig(root) {
  for (const name of CONFIG_NAMES) {
    const file = path.join(root, name);
    try {
      if (fs.statSync(file).isFile()) return file;
    } catch (_) {
      /* not here */
    }
  }
  return null;
}

function dependencyBags(pkg) {
  return ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]
    .map((key) => pkg && pkg[key])
    .filter(Boolean);
}

function declaresNext(pkg) {
  return dependencyBags(pkg).some((bag) => Object.prototype.hasOwnProperty.call(bag, "next"));
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
  const quote = src[i];
  i += 1;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (quote === "`" && c === "$" && src[i + 1] === "{") {
      let depth = 1;
      i += 2;
      while (i < src.length && depth > 0) {
        const d = src[i];
        if (d === "{") depth += 1;
        else if (d === "}") depth -= 1;
        else if (d === '"' || d === "'" || d === "`") {
          i = skipString(src, i);
          continue;
        }
        i += 1;
      }
      continue;
    }
    if (c === quote) return i + 1;
    i += 1;
  }
  return i;
}

/** Find the first top-level occurrence of any target string. */
function findTopLevel(src, targets) {
  let i = 0;
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      const e = src.indexOf("\n", i);
      i = e === -1 ? src.length : e + 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const e = src.indexOf("*/", i + 2);
      i = e === -1 ? src.length : e + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(src, i);
      continue;
    }
    if (c === "{" || c === "(" || c === "[") {
      depth += 1;
      i += 1;
      continue;
    }
    if (c === "}" || c === ")" || c === "]") {
      depth -= 1;
      i += 1;
      continue;
    }
    if (depth === 0) {
      for (const target of targets) {
        if (src.startsWith(target, i)) return { index: i, token: target };
      }
    }
    i += 1;
  }
  return null;
}

/** Index just past the statement starting at `start` (its terminating `;`, else EOF). */
function statementEnd(src, start) {
  let i = start;
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(src, i);
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const e = src.indexOf("\n", i);
      i = e === -1 ? src.length : e + 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const e = src.indexOf("*/", i + 2);
      i = e === -1 ? src.length : e + 2;
      continue;
    }
    if (c === "{" || c === "(" || c === "[") depth += 1;
    else if (c === "}" || c === ")" || c === "]") depth -= 1;
    else if (c === ";" && depth <= 0) return i + 1;
    i += 1;
  }
  return src.length;
}

const SNIPPET =
  'import blazefire from "blazefire/plugin";\nexport default blazefire(nextConfig);';

/* ------------------------------------------------------------------ *
 * the actual rewrite
 * ------------------------------------------------------------------ */

function plan(src) {
  const hit = findTopLevel(src, ["export default", "module.exports"]);
  if (!hit) return { ok: false, reason: "no top-level `export default` found" };

  const isEsm = hit.token === "export default";
  const headEnd = hit.index + hit.token.length;
  const rest = src.slice(headEnd);

  // Two default exports (the exact mistake this tool exists to fix) must not
  // be "repaired" by wrapping only the first — refuse and explain instead.
  if (findTopLevel(rest, ["export default", "module.exports"])) {
    return { ok: false, reason: "file declares a default export more than once" };
  }

  // Function-style configs are fine: blazefire() detects a function argument
  // and wraps the config it returns, so Next still gets its (phase, ctx) call.
  // A `class` is not a config shape at all — refuse rather than guess.
  if (isEsm && /^\s+class\b/.test(rest)) {
    return { ok: false, reason: "`export default class` is not a Next config" };
  }
  if (/^\s*\{?[^;]*\bas\s+default\b/.test(src.slice(Math.max(0, hit.index - 120), headEnd))) {
    return { ok: false, reason: "`export { x as default }` form not supported" };
  }

  // Skip past `export default` / `module.exports` and any `=` / `satisfies` glue
  // to the start of the expression itself.
  let exprStart = headEnd;
  while (exprStart < src.length && /[ \t\r\n=]/.test(src[exprStart])) exprStart += 1;

  const endOfStatement = statementEnd(src, exprStart);
  // statementEnd returns either just past a depth-0 `;` or the end of file,
  // so the byte before it tells us which — scanning raw text for ';' would
  // misfire on a `;` nested inside a function body.
  const semicolon = endOfStatement > 0 && src[endOfStatement - 1] === ";";

  let expression;
  let exprEnd;
  if (semicolon) {
    expression = src.slice(exprStart, endOfStatement - 1).trim();
    exprEnd = endOfStatement; // the `;` is re-emitted by the replacement
  } else {
    const raw = src.slice(exprStart, endOfStatement);
    const trimmed = raw.trimEnd();
    expression = trimmed.trim();
    // Stop before trailing whitespace so blank lines / final newline stay in
    // the tail instead of being swallowed by the wrapped call.
    exprEnd = exprStart + trimmed.length;
  }

  if (!expression) return { ok: false, reason: "could not locate the config expression" };

  // `mid` (the slice from insertAt up to exprStart) already carries the
  // `export default` / `module.exports =` keyword verbatim, so the replacement
  // must be ONLY the call — re-emitting the keyword here doubles it and emits
  // `export default export default ...`, a hard syntax error.
  const replacement = `blazefire(${expression})${semicolon ? ";" : ""}`;

  const firstImport = findTopLevel(src, ["import "]);
  let insertAt = firstImport ? firstImport.index : hit.index;
  if (insertAt > hit.index) insertAt = hit.index;
  if (src.startsWith("#!")) {
    const nl = src.indexOf("\n");
    if (nl !== -1 && nl < insertAt) insertAt = nl + 1;
  }

  return {
    ok: true,
    isEsm,
    insertAt,
    exprStart,
    exprEnd,
    replacement,
    line: isEsm ? ESM_IMPORT : CJS_REQUIRE,
  };
}

function rewrite(src) {
  const p = plan(src);
  if (!p.ok) return p;

  // Respect the file's own line endings, otherwise a Windows-authored config
  // ends up with one LF line in a CRLF document.
  const eol = src.includes("\r\n") ? "\r\n" : "\n";

  const head = src.slice(0, p.insertAt);
  const mid = src.slice(p.insertAt, p.exprStart);
  const tail = src.slice(p.exprEnd);
  return { ok: true, code: head + p.line + eol + mid + p.replacement + tail };
}

/* ------------------------------------------------------------------ *
 * driver
 * ------------------------------------------------------------------ */

function backup(originalFile, contents, projectRoot) {
  const backupRoot = path.join(projectRoot, BACKUP_DIR);
  const saved = path.join(backupRoot, path.basename(originalFile));
  fs.mkdirSync(backupRoot, { recursive: true });
  // First copy wins: it is the pristine pre-Blazefire original.
  if (!fs.existsSync(saved)) fs.writeFileSync(saved, contents, "utf8");
  return saved;
}

function noteGitignore(projectRoot) {
  const file = path.join(projectRoot, ".gitignore");
  try {
    if (!fs.existsSync(file)) return;
    const current = fs.readFileSync(file, "utf8");
    if (current.includes(BACKUP_DIR)) return;
    const sep = current.endsWith("\n") || current === "" ? "" : "\n";
    fs.writeFileSync(
      file,
      current + sep + "\n# Blazefire keeps a copy of the config it edits\n" + BACKUP_DIR + "/\n",
      "utf8"
    );
  } catch (_) {
    /* cosmetic only */
  }
}

function activate(projectRoot, configPath, original) {
  const result = rewrite(original);
  if (!result.ok) {
    say("could not auto-edit " + path.basename(configPath) + " (" + result.reason + ").");
    say("paste this in manually instead:");
    say(SNIPPET.split("\n").join("\n         "));
    return;
  }

  const saved = backup(configPath, original, projectRoot);
  fs.writeFileSync(configPath, result.code, "utf8");
  noteGitignore(projectRoot);

  say(
    "activated " +
      path.basename(configPath) +
      " — original saved to " +
      path.relative(projectRoot, saved).split(path.sep).join("/")
  );
}

function locateCandidates() {
  // Our own package root: the nearest package.json above this file. A
  // candidate may never resolve back to it, so we can never edit ourselves.
  // It can legitimately be null (e.g. running cli.cjs straight from a
  // temp dir), in which case cwd alone decides.
  const ownRoot = findNearestPackageRoot(__dirname);

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
  ].filter(Boolean);

  return { ownRoot, candidates };
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
  const cli = !!(opts && opts.cli);
  if (process.env.BLAZEFIRE_SKIP_AUTO && !cli) return "not-found";

  const located = locateCandidates();
  const { ownRoot, candidates } = located;

  const seen = new Set();
  let sawConfig = null;
  let declaredNext = false;

  for (const start of candidates) {
    const projectRoot = findNearestPackageRoot(start);
    if (!projectRoot || (ownRoot && projectRoot === ownRoot) || seen.has(projectRoot)) continue;
    seen.add(projectRoot);

    const pkg = readJson(path.join(projectRoot, "package.json"));
    const configPath = findConfig(projectRoot);
    if (configPath && !sawConfig) sawConfig = { projectRoot, configPath };

    if (declaresNext(pkg)) declaredNext = true;
    if (!configPath) continue;

    const original = fs.readFileSync(configPath, "utf8");
    if (original.includes(MARKER)) {
      if (cli) say("already active — " + path.basename(configPath) + " is wired up.");
      return "already";
    }

    // Only ever write where `next` is genuinely installed.
    const hasInstalledNext = fs.existsSync(path.join(projectRoot, "node_modules", "next"));
    if (!hasInstalledNext && !(cli && declaresNext(pkg))) continue;

    activate(projectRoot, configPath, original);
    return "activated";
  }

  // Nothing safe to write. Stay quiet unless this really is a Next.js project.
  if (sawConfig) {
    say("found " + path.basename(sawConfig.configPath) + " but node_modules/next is missing — skipped.");
    say("run your install, then add: " + SNIPPET.replace(/\n/g, " "));
    return "manual";
  }
  if (declaredNext) {
    say("this looks like a Next.js project but there is no next.config.* — add:");
    say(SNIPPET.split("\n").join("\n         "));
    return "manual";
  }
  if (cli) {
    say("no next.config.* found from " + process.cwd() + " — run this in your project root, or add:");
    say(SNIPPET.split("\n").join("\n         "));
  }
  return "not-found";
}

/**
 * Undo activation by copying `Blazefire Backup/` back over the config.
 *
 * @returns {number} process exit code
 */
function restore() {
  const located = locateCandidates();
  if (!located) return 1;
  const { ownRoot, candidates } = located;

  const seen = new Set();
  for (const start of candidates) {
    const projectRoot = findNearestPackageRoot(start);
    if (!projectRoot || projectRoot === ownRoot || seen.has(projectRoot)) continue;
    seen.add(projectRoot);

    const backupRoot = path.join(projectRoot, BACKUP_DIR);
    if (!fs.existsSync(backupRoot)) continue;

    let restored = 0;
    for (const name of CONFIG_NAMES) {
      const saved = path.join(backupRoot, name);
      if (!fs.existsSync(saved)) continue;
      fs.copyFileSync(saved, path.join(projectRoot, name));
      say("restored " + name + " from " + BACKUP_DIR + "/");
      restored += 1;
    }
    if (restored > 0) return 0;
  }

  say("no backups in " + BACKUP_DIR + "/ — nothing to restore.");
  return 1;
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    // A postinstall must never fail someone's install — and an error thrown
    // in a `finally` would escape this handler and abort it, so there isn't one.
    say("auto-activation skipped: " + (error && error.message ? error.message : error));
    process.exitCode = 0;
  }
}

module.exports = { run, restore, plan, rewrite, findConfig, SNIPPET, BACKUP_DIR, MARKER };
