<div align="center">
  <h1>Blazefire</h1>
  <p>Blazefire framework powered by Frostfast compiler</p>
</div>

## Early Showcase of custom error overlay triggered by hydration mismatch
<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/91770e1d-d05f-491c-ac95-a4384e5bad44" />

# Blazefire Framework 🔥

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

After installing with any package manager, run the activation command once
from your app's directory:

```bash
npx blazefire init
```

This explicit step works even when a package manager skips dependency
install scripts or requires approval before running them. It backs up your
original `next.config.*` to `Blazefire Backup/`, wraps the config with
`blazefire()`, and adds a project `postinstall` hook so later installs can
auto-activate. If you use Yarn Plug'n'Play, run `yarn blazefire init` instead
so Yarn loads its PnP environment.

### Monorepos and workspaces

Installing at the repository root is fine even when the root has no Next.js
config. The installer then looks inside the workspaces you have *declared* —
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
import { BlazefireLogo, BlazefireErrorOverlay } from 'blazefire';
import { insertBlazefireStyles } from 'blazefire/styles';
import { createCompiler } from 'blazefire/compiler';

// Insert styles
insertBlazefireStyles();

// Create compiler instance
const compiler = createCompiler();

// Use components
function App() {
  return (
    <BlazefireErrorOverlay
      errorType="Runtime Error"
      errorMessage="Something went wrong"
      onClose={() => {}}
    />
  );
}
```

## Compiler

The Frostfast compiler provides:

- SWC-based transformations
- Turbopack bundling
- TypeScript/JSX support
- Hot module replacement

```js
import { createCompiler, FROSTFAST_VERSION } from 'blazefire/compiler';

const compiler = createCompiler({
  // Custom options
});

console.log(`Frostfast v${FROSTFAST_VERSION}`);
```

## Components

- `BlazefireLogo` - Flame logo with neon glow
- `BlazefireErrorHeader` - Error overlay header
- `BlazefireErrorOverlay` - Full error overlay
- `BlazefireDevToolsIndicator` - Floating dev tools button

## Styles

Import the CSS files for the full cyberpunk theme:

```css
@import 'blazefire/assets/blazefire-dark-theme.css';
@import 'blazefire/assets/blazefire-global.css';
```

## License

MIT
