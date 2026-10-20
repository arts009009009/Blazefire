# Blazefire

Blazefire framework powered by Frostfast compiler.

![Blazefire logo](./assets/blazefire-logo.png)

## Install

Blazefire installs with npm, pnpm, Yarn, and bun:

```bash
npm install github:arts009009009/Blazefire

# pnpm (in a pnpm-managed project — see the notes below)
pnpm add github:arts009009009/Blazefire

# Yarn Berry (2+): avoids the Git repository approval gate
yarn add blazefire@https://github.com/arts009009009/Blazefire/archive/refs/heads/main.tar.gz

# bun
bun add github:arts009009009/Blazefire
```

When dependency install scripts are enabled, Blazefire automatically activates
the nearest Next.js config and saves the original in `Blazefire Backup/`.
Yarn Plug'n'Play is supported.

Notes per package manager:

- **bun** blocks a dependency's own postinstall script by default
  (`Blocked 1 postinstall`). Either run `npx blazefire init` once after
  installing, or allowlist the script by adding
  `"trustedDependencies": ["blazefire"]` to your package.json before adding
  Blazefire.
- **pnpm** refuses to touch a project whose `packageManager` field names yarn
  or npm (`This project is configured to use yarn`). That check runs before
  any package is fetched, so no dependency — Blazefire included — can
  override it: use the manager the project is configured for, or drop the
  field to adopt pnpm.
- **Yarn Berry** asks for approval before fetching Git dependencies; the
  tarball-URL form above avoids the gate.
- **npm** needs no extra setup.

Package-manager security settings can prevent dependency scripts from running;
a dependency cannot change those settings before it is installed.

`npx blazefire update` re-installs the latest release using whichever manager
your project uses (npm, pnpm, Yarn, or bun), clearing the manager's cached
copy first so the update really lands.

## Usage

```jsx
import Blazefire from 'blazefire'
import 'blazefire/styles'
import { BlazefireLogo } from 'blazefire/components/BlazefireLogo'
import translations from 'blazefire/data/navbar-translate.json'
```

## Compiler

The `blazefire/compiler` entry transforms TypeScript and JSX using the SWC
bindings from the Next.js installation in the current project. It runs in
Node.js, requires Next.js to be installed, and does not perform TypeScript
type-checking. Next.js remains responsible for bundling and hot module
replacement.

```js
import { createCompiler } from 'blazefire/compiler'

const compiler = createCompiler({ target: 'es2022' })
const result = await compiler.compile('export const value: number = 1')
console.log(result.code)
```
