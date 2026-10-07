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

Install straight from GitHub — the package is not published to npm.

```bash
npm install github:arts009009009/Blazefire
# or
yarn add github:arts009009009/Blazefire
```

npm and yarn activate automatically: your `next.config.*` is copied to
`Blazefire Backup/` and the export is wrapped with `blazefire()`.

### pnpm

pnpm installs it, but skips third-party build scripts by default, so the
auto-activation never runs. Either approve it once:

```bash
pnpm approve-builds    # select blazefire
pnpm install
```

or skip the allowlist and activate it yourself:

```bash
pnpm exec blazefire init
```

### bun

Same story — bun blocks untrusted postinstalls. Allow it in your
`package.json`:

```json
"trustedDependencies": ["blazefire"]
```

### Not supported: Deno

Deno's installer only resolves npm-registry and JSR specifiers, so it drops
`github:` (and `git+https`) dependencies without an error. Use npm, yarn or
pnpm to install, then run `npx blazefire init`.

### Fallback (any manager, incl. `--ignore-scripts`)

```bash
npx blazefire init      # activate
npx blazefire restore   # put the original config back
```

Set `BLAZEFIRE_SKIP_AUTO=1` to opt out of auto-activation on install.

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
