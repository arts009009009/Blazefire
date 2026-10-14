# Blazefire

Blazefire framework powered by Frostfast compiler.

![Blazefire logo](./assets/blazefire-logo.png)

## Install

```bash
npm install github:arts009009009/Blazefire

# Yarn Berry (2+): avoids the Git repository approval gate
yarn add blazefire@https://github.com/arts009009009/Blazefire/archive/refs/heads/main.tar.gz
```

When dependency install scripts are enabled, Blazefire automatically activates
the nearest Next.js config and saves the original in `Blazefire Backup/`.
Yarn Plug'n'Play is supported. Package-manager security settings can prevent
dependency scripts from running; a dependency cannot change those settings
before it is installed.

## Usage

```jsx
import Blazefire from 'blazefire'
import 'blazefire/styles'
import { BlazefireLogo } from 'blazefire/components/BlazefireLogo'
import translations from 'blazefire/data/navbar-translate.json'
```
