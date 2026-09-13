<div align="center">
  <h1>Blazefire</h1>
  <p>Blazefire framework powered by Frostfast compiler</p>
</div>

## Early Showcase of custom error overlay triggered by hydration mismatch
<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/91770e1d-d05f-491c-ac95-a4384e5bad44" />


## Features

- Cyberpunk/OLED dark theme
- Neon glow effects
- Flame logo with gradient
- Error overlay with custom branding
- DevTools indicator
- Frostfast compiler (SWC + Turbopack)

## Installation

```bash
npm install blazefire
```

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
