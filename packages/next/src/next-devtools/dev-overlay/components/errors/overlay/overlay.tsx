import { css } from '../../../utils/css'
import { Overlay, type OverlayProps } from '../../overlay/overlay'

export function ErrorOverlayOverlay({ children, ...props }: OverlayProps) {
  return <Overlay {...props}>{children}</Overlay>
}

export const OVERLAY_STYLES = css`
  [data-blazefire-dialog-overlay] {
    padding: initial;
    top: 10vh;
  }
`
