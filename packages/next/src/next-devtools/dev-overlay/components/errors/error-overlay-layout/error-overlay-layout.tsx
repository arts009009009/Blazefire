import * as React from 'react'
import type { DebugInfo } from '../../../../shared/types'
import type { ErrorMessageType } from '../error-message/error-message'
import type { ErrorType } from '../error-type-label/error-type-label'

import { DialogContent } from '../../dialog'
import {
  ErrorOverlayToolbar,
  styles as toolbarStyles,
} from '../error-overlay-toolbar/error-overlay-toolbar'
import { ErrorOverlayFooter } from '../error-overlay-footer/error-overlay-footer'
import {
  ErrorMessage,
  styles as errorMessageStyles,
} from '../error-message/error-message'
import {
  ErrorTypeLabel,
  styles as errorTypeLabelStyles,
} from '../error-type-label/error-type-label'
import {
  ErrorOverlayNav,
  styles as floatingHeaderStyles,
} from '../error-overlay-nav/error-overlay-nav'
import type { ErrorOverlayTabBarRenderer } from '../error-overlay-pagination/error-overlay-pagination'

import { ErrorOverlayDialog, DIALOG_STYLES } from '../dialog/dialog'
import {
  ErrorOverlayDialogHeader,
  DIALOG_HEADER_STYLES,
} from '../dialog/header'
import { ErrorOverlayDialogBody, DIALOG_BODY_STYLES } from '../dialog/body'
import { OVERLAY_STYLES, ErrorOverlayOverlay } from '../overlay/overlay'
import type { ErrorBaseProps } from '../error-overlay/error-overlay'
import type { ReadyRuntimeError } from '../../../utils/get-error-by-type'
import { EnvironmentNameLabel } from '../environment-name-label/environment-name-label'
import { useFocusTrap } from '../dev-tools-indicator/utils'
import { Resizer } from '../../resizer'
import { OverlayBackdrop } from '../../overlay'

export interface ErrorOverlayLayoutProps extends ErrorBaseProps {
  errorMessage: ErrorMessageType
  errorType: ErrorType
  children?: React.ReactNode
  headerChildren?: React.ReactNode
  renderTabBar?: ErrorOverlayTabBarRenderer
  canGoPrevious?: boolean
  canGoNext?: boolean
  onPrevious?: () => void
  onNext?: () => void
  errorCode?: string
  error: ReadyRuntimeError['error']
  debugInfo?: DebugInfo
  isBuildError?: boolean
  onClose?: () => void
  // TODO: better handle receiving
  runtimeErrors?: ReadyRuntimeError[]
  activeIdx?: number
  setActiveIndex?: (index: number) => void
  dialogResizerRef?: React.RefObject<HTMLDivElement | null>
  generateErrorInfo: () => Promise<string>
}

export function ErrorOverlayLayout({
  errorMessage,
  errorType,
  children,
  headerChildren,
  renderTabBar,
  canGoPrevious,
  canGoNext,
  onPrevious,
  onNext,
  errorCode,
  errorCount: _errorCount,
  error,
  debugInfo,
  isBuildError,
  onClose,
  versionInfo,
  runtimeErrors,
  activeIdx,
  setActiveIndex,
  dialogResizerRef,
  generateErrorInfo,
  // This prop is used to animate the dialog, it comes from a parent component (<ErrorOverlay>)
  // If it's not being passed, we should just render the component as it is being
  // used without the context of a parent component that controls its state (e.g. Storybook).
  rendered = true,
  transitionDurationMs,
}: ErrorOverlayLayoutProps) {
  const animationProps = {
    'data-rendered': rendered,
    style: {
      '--transition-duration': `${transitionDurationMs}ms`,
    } as React.CSSProperties,
  }

  const [animating, setAnimating] = React.useState(
    Boolean(transitionDurationMs)
  )

  const hasFooter = Boolean(errorCode)
  const dialogRef = React.useRef<HTMLDivElement | null>(null)
  useFocusTrap(dialogRef, null, rendered)

  function onTransitionEnd({ propertyName, target }: React.TransitionEvent) {
    // We can only measure height after the `scale` transition ends,
    // otherwise we will measure height as a multiple of the animating value
    // which will give us an incorrect value.
    if (propertyName === 'scale' && target === dialogRef.current) {
      setAnimating(false)
    }
  }

  return (
    <ErrorOverlayOverlay {...animationProps}>
      <OverlayBackdrop fixed={isBuildError} />
      <div
        data-nextjs-dialog-root
        onTransitionEnd={onTransitionEnd}
        ref={dialogRef}
        {...animationProps}
      >
        <ErrorOverlayNav
          runtimeErrors={runtimeErrors}
          activeIdx={activeIdx}
          setActiveIndex={setActiveIndex}
          canGoPrevious={canGoPrevious}
          canGoNext={canGoNext}
          onPrevious={onPrevious}
          onNext={onNext}
          versionInfo={versionInfo}
          renderTabBar={renderTabBar}
        />
        <ErrorOverlayDialog onClose={onClose} data-has-footer={hasFooter}>
          <Resizer
            ref={dialogResizerRef}
            measure={!animating}
            data-nextjs-dialog-sizer
          >
            <DialogContent>
              <ErrorOverlayDialogHeader>
                <div className="blazefire-branding-header">
                  <svg width="28" height="28" viewBox="0 0 40 40" fill="none">
                    <defs>
                      <linearGradient id="bf_header_flame" x1="20" y1="5" x2="20" y2="35" gradientUnits="userSpaceOnUse">
                        <stop stopColor="#ff8800" />
                        <stop offset="0.4" stopColor="#ff4400" />
                        <stop offset="0.7" stopColor="#ff006e" />
                        <stop offset="1" stopColor="#cc00cc" />
                      </linearGradient>
                      <filter id="bf_glow">
                        <feGaussianBlur stdDeviation="1" result="blur"/>
                        <feMerge>
                          <feMergeNode in="blur"/>
                          <feMergeNode in="SourceGraphic"/>
                        </feMerge>
                      </filter>
                    </defs>
                    <g filter="url(#bf_glow)">
                      <path d="M20 3 C20 3 30 14 30 23 C30 28 25.5 32 20 32 C14.5 32 10 28 10 23 C10 14 20 3 20 3Z" fill="url(#bf_header_flame)" />
                      <path d="M20 11 C20 11 25 18 25 23 C25 25.8 22.8 28 20 28 C17.2 28 15 25.8 15 23 C15 18 20 11 20 11Z" fill="url(#bf_header_flame)" opacity="0.6" />
                      <path d="M20 16 C20 16 22.5 20 22.5 23 C22.5 24.4 21.4 25.5 20 25.5 C18.6 25.5 17.5 24.4 17.5 23 C17.5 20 20 16 20 16Z" fill="#ffcc00" opacity="0.8" />
                    </g>
                  </svg>
                  <span className="blazefire-branding-text">Blazefire</span>
                </div>
                <div
                  className="nextjs__container_errors__error_title"
                  // allow assertion in tests before error rating is implemented
                  data-nextjs-error-code={errorCode}
                >
                  <div className="nextjs__container_errors__error_title__row">
                    <span data-nextjs-error-label-group>
                      <ErrorTypeLabel errorType={errorType} />
                      {error.environmentName && (
                        <EnvironmentNameLabel
                          environmentName={error.environmentName}
                        />
                      )}
                    </span>
                    <ErrorOverlayToolbar
                      error={error}
                      debugInfo={debugInfo}
                      generateErrorInfo={generateErrorInfo}
                    />
                  </div>
                  <ErrorMessage
                    errorMessage={errorMessage}
                    errorType={errorType}
                  />
                </div>
                {headerChildren}
              </ErrorOverlayDialogHeader>
              <ErrorOverlayDialogBody>{children}</ErrorOverlayDialogBody>
            </DialogContent>
          </Resizer>
        </ErrorOverlayDialog>
        {hasFooter && <ErrorOverlayFooter errorCode={errorCode} />}
      </div>
    </ErrorOverlayOverlay>
  )
}

export const styles = `
  ${OVERLAY_STYLES}
  ${DIALOG_STYLES}
  ${DIALOG_HEADER_STYLES}
  ${DIALOG_BODY_STYLES}

  ${floatingHeaderStyles}
  ${errorTypeLabelStyles}
  ${errorMessageStyles}
  ${toolbarStyles}

  [data-nextjs-error-label-group] {
    display: flex;
    align-items: center;
    gap: 8px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .blazefire-branding-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    background: linear-gradient(135deg, rgba(0, 255, 255, 0.05) 0%, rgba(255, 0, 255, 0.05) 100%);
    border-bottom: 1px solid rgba(0, 255, 255, 0.15);
  }

  .blazefire-branding-text {
    font-size: 14px;
    font-weight: 600;
    background: linear-gradient(90deg, #ff8800, #ff006e);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
`
