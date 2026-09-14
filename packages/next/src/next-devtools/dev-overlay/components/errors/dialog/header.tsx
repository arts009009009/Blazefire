import { DialogHeader } from '../../dialog/dialog-header'

type ErrorOverlayDialogHeaderProps = {
  children?: React.ReactNode
}

export function ErrorOverlayDialogHeader({
  children,
}: ErrorOverlayDialogHeaderProps) {
  return (
    <DialogHeader className="blazefire-container-errors-header">
      {children}
    </DialogHeader>
  )
}

export const DIALOG_HEADER_STYLES = `
  .blazefire-container-errors-header {
    position: relative;
  }
  [data-blazefire-dialog-content] > .blazefire-container-errors-header {
    margin-bottom: 0;
  }
  .blazefire-container-errors-header > h1 {
    font-size: var(--size-20);
    line-height: var(--size-24);
    font-weight: bold;
    margin: calc(16px * 1.5) 0;
    color: var(--color-title-color);
  }
  .blazefire-container-errors-header small {
    font-size: var(--size-14);
    color: var(--color-accents-1);
    margin-left: 16px;
  }
  .blazefire-container-errors-header small > span {
    font-family: var(--font-stack-monospace);
  }
  .blazefire-container-errors-header > div > small {
    margin: 0;
    margin-top: 4px;
  }
  .blazefire-container-errors-header > p > a {
    font-weight: 600;
    color: #00ffff;
  }
  .blazefire-container-errors-header
    > .blazefire-container-build-error-version-status {
    position: absolute;
    top: 16px;
    right: 16px;
  }
`
