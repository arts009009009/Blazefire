'use strict'

const path = require('path')
const ts = require('typescript')

describe('consumer TypeScript declarations', () => {
  it('type-checks the documented root and compiler entry points', () => {
    const fixture = path.join(__dirname, 'types', 'public-api.tsx')
    const program = ts.createProgram([fixture], {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      jsx: ts.JsxEmit.ReactJSX,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
    })
    const diagnostics = ts.getPreEmitDiagnostics(program).map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    )

    expect(diagnostics).toEqual([])
  })
})
