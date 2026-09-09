export function renderAppDevOverlay() {
  throw new Error(
    "Blazefire DevTools: Can't render in this environment. This is a bug in Blazefire"
  )
}

export function renderPagesDevOverlay() {
  throw new Error(
    "Blazefire DevTools: Can't render in this environment. This is a bug in Blazefire"
  )
}

// TODO: Extract into separate functions that are imported
export const dispatcher = new Proxy(
  {},
  {
    get: (_, prop) => {
      return () => {
        throw new Error(
          `Blazefire DevTools: Can't dispatch ${String(prop)} in this environment. This is a bug in Blazefire`
        )
      }
    },
  }
)
