<div align="center">
  <h1>Blazefire</h1>
  <p>Blazefire framework powered by Frostfast compiler</p>
</div>

> **⚠️ Experimental**
> This repo is not ready for any use — it is experimental. No contributing or
> forking is allowed.

## Early Showcase of custom error overlay triggered by hydration mismatch

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/91770e1d-d05f-491c-ac95-a4384e5bad44" />

# Blazefire Framework 🔥

![Blazefire logo](./blazefire/assets/blazefire-logo.png)

Blazefire is a chaos‑driven web framework with custom runtime, overlay branding, and compiler hooks.  
It’s inspired by modern meta‑frameworks like Next.js, but built with its own identity and features.

## Acknowledgements

- [Next.js](https://nextjs.org/) — for pioneering the meta‑framework model and inspiring routing + SSR concepts.
- Frostfast Compiler — powering Blazefire’s runtime speed.
- Community devs who shaped the ecosystem we build on.

## Features

- Cyberpunk/OLED dark theme
- Neon glow effects
- Flame logo with gradient
- Error overlay with custom branding
- DevTools indicator
- Frostfast compiler (SWC + Turbopack)

## Installation

Install straight from GitHub — the package is not published to npm. For Yarn
Berry, use the archive URL so Yarn does not require a Git repository approval.

```bash
# npm
npm install github:arts009009009/Blazefire

# Yarn (Classic or Berry)
yarn add blazefire@https://github.com/arts009009009/Blazefire/archive/refs/heads/main.tar.gz

# pnpm
pnpm add github:arts009009009/Blazefire

# Bun
bun add github:arts009009009/Blazefire
```

That is all for npm, Yarn 1, and pnpm. Yarn Berry and pnpm each need one extra
step — see below. Your `next.config.*` is copied
to `Blazefire Backup/` and its export is wrapped with `blazefire()` — and
activation writes this into your `package.json`:

```json
"postinstall": "blazefire init || echo blazefire skipped"
```

A project's own scripts are never blocked, so once that line is committed
**every** package manager self-activates on install, including the ones
below. Commit it alongside the config.

### Yarn Berry (2+)

Berry ships with `enableScripts: false` and an empty git allowlist, so it
runs no dependency install scripts and blocks **every** `github:`
dependency until you opt in. One `.yarnrc.yml` at the project root covers
both gates:

```yaml
nodeLinker: node-modules
enableScripts: true
approvedGitRepositories:
  - 'https://github.com/**'
```

Patterns match the resolved HTTPS URL, and `**` is required —
`https://github.com/*` stops one path segment short, and a bare `*` never
matches a URL containing slashes.

Prefer not to enable every dependency's scripts? Drop `enableScripts` and
allow just this package from `package.json`:

```json
{ "dependenciesMeta": { "blazefire": { "built": true } } }
```

Or skip the git allowlist entirely by installing the tarball:

```bash
yarn add blazefire@https://github.com/arts009009009/Blazefire/archive/refs/tags/v1.0.0.tar.gz
```

Using Yarn Plug'n'Play instead (no `node_modules`)? Run `yarn blazefire init`
rather than `npx`, so Yarn loads its PnP environment and `next` resolves
through it.

This is **one-time** setup: once the hook exists in `package.json`,
project scripts always run regardless of `enableScripts`, so later
installs — including a fresh clone — self-activate under stock Berry
defaults.

### pnpm

pnpm installs fine, but skips a _dependency's_ build scripts by default, so
the very first install activates nothing. Bootstrap it once:

```bash
pnpm exec blazefire init      # or: pnpm approve-builds, then pnpm install
```

After that the hook takes over and no allowlist is needed. Worth knowing:
an `onlyBuiltDependencies` entry for a git dependency embeds the full commit
SHA, so it quietly stops matching on your next commit — the hook doesn't.

### bun

Same one-time bootstrap — bun blocks untrusted postinstalls:

```bash
bunx blazefire init
```

or allow the package outright in your `package.json`:

```json
"trustedDependencies": ["blazefire"]
```

### Monorepos and workspaces

Installing at the repository root is fine even when the root has no Next.js
config. The installer then looks inside the workspaces you have _declared_ —
`package.json#workspaces` (npm, yarn, pnpm) or the `packages:` list in
`pnpm-workspace.yaml` — and activates the one that actually holds a
`next.config.*`:

```text
elite-shop/              blazefire installed here
├── package.json
├── pnpm-workspace.yaml    packages: ["frontend"]
└── frontend/             the app
    ├── next.config.ts      wrapped + copied to frontend/Blazefire Backup/
    └── package.json        receives the self-activation hook
```

The backup and the hook both land beside the app rather than at the root, and
`npx blazefire restore` reaches them from either place. Only declared
workspaces are searched — nothing is found by scanning directories — so the
outcome is deterministic.

### Not supported: Deno

Deno's installer only resolves npm-registry and JSR specifiers, so it drops
`github:` (and `git+https`) dependencies without an error. Use npm, Yarn, pnpm,
or Bun to install, then run `npx blazefire init`.

### Restore

To undo activation, restore the original config and remove Blazefire's
postinstall hook:

```bash
npx blazefire restore
```

Set `BLAZEFIRE_SKIP_AUTO=1` to opt out of auto-activation entirely: no hook
is written, and an existing hook honours the flag too.

## Usage

```jsx
import {
  insertBlazefireStyles,
  createCompiler,
  BlazefireProvider,
} from 'blazefire'
import { BlazefireLogo } from 'blazefire/components/BlazefireLogo'
import { BlazefireErrorOverlay } from 'blazefire/components/BlazefireErrorOverlay'

// Insert styles (safe to call from a Server Component — it no-ops on the server)
insertBlazefireStyles()

// Create compiler instance
const compiler = createCompiler()

// Use components (client components — import them from blazefire/components/*)
function App() {
  return (
    <BlazefireProvider>
      <BlazefireLogo size={48} />
      <BlazefireErrorOverlay
        errorType="Runtime Error"
        errorMessage="Something went wrong"
        onClose={() => {}}
      />
    </BlazefireProvider>
  )
}
```

## Compiler

The Frostfast compiler provides:

- SWC-based transformations
- Turbopack bundling
- TypeScript/JSX support
- Hot module replacement

```js
import { createCompiler, COMPILER_VERSION } from 'blazefire/compiler'

const compiler = createCompiler({
  // Custom options
})

console.log(`Compiler v${COMPILER_VERSION}`)
```

Note: the compiler entry (`blazefire/compiler`) is separate from the root
`createCompiler()` export — the root version is a lightweight options
container, while the compiler entry exposes the full transform pipeline.

## Components

Import components from their `blazefire/components/*` subpath (they are
client components):

- `BlazefireLogo` - Flame logo with neon glow — `blazefire/components/BlazefireLogo`
- `BlazefireErrorOverlay` - Full error overlay — `blazefire/components/BlazefireErrorOverlay`
- `BlazefireDevTools` - Floating dev tools indicator/panel — `blazefire/components/BlazefireDevTools`

The root entry (`blazefire`) exports the runtime utilities and
`BlazefireProvider` / `useBlazefire`, not the components.

## Styles

Import the CSS file for the full cyberpunk theme:

```css
@import 'blazefire/styles';
```

Or inject the equivalent styles at runtime (e.g. when you can't ship a CSS
import):

```js
import { insertBlazefireStyles } from 'blazefire'
```

## License

MIT
