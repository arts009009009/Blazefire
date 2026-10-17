/**
 * babel-jest picks this up automatically for every ".js" file Jest
 * transforms (test files and the package's own ESM sources — utils.js,
 * index.js, provider.js, src/components/*.js).
 *
 * The only transformation that matters here is the ESM→CJS module transform:
 * the package is "type": "module" with hand-written ESM .js sources, and
 * Jest's default (CommonJS) module system cannot execute them without it.
 * Everything else stays untouched — targets node: 'current' means no syntax
 * down-leveling, so tests exercise exactly the code that ships.
 *
 * ".cjs" files are NOT in Jest's default transform pattern and run raw.
 */

'use strict'

module.exports = {
  presets: [
    [
      '@babel/preset-env',
      {
        targets: { node: 'current' },
        // 'auto' resolves to 'commonjs' under babel-jest (its caller does not
        // declare static ESM support), which is exactly what we want.
        modules: 'auto',
      },
    ],
  ],
}
