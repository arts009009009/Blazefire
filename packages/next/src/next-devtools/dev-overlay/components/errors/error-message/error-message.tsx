import { useState, useRef, useLayoutEffect } from 'react'
import type { ErrorType } from '../error-type-label/error-type-label'

export type ErrorMessageType = React.ReactNode

type ErrorMessageProps = {
  errorMessage: ErrorMessageType
  errorType: ErrorType
}

export function ErrorMessage({ errorMessage, errorType }: ErrorMessageProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isTooTall, setIsTooTall] = useState(false)
  const messageRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (messageRef.current) {
      setIsTooTall(messageRef.current.scrollHeight > 200)
    }
  }, [errorMessage])

  if (!errorMessage) {
    return null
  }

  // Instant errors are formatted specifically for the overlay rather than
  // passed through from the console, so we don't truncate them — they rely
  // on scroll overflow instead.
  const shouldTruncate =
    isTooTall && errorType !== 'Instant' && errorType !== 'Blocking Route'

  return (
    <>
      <div className="nextjs__container_errors_wrapper">
        <div
          ref={messageRef}
          id="nextjs__container_errors_desc"
          className={`nextjs__container_errors_desc ${shouldTruncate && !isExpanded ? 'truncated' : ''} ${errorType === 'Instant' || errorType === 'Blocking Route' ? 'nextjs__container_errors_desc_instant' : ''}`}
        >
          {errorMessage}
        </div>
      </div>
      {shouldTruncate && !isExpanded && (
        <>
          <div className="nextjs__container_errors_gradient_overlay" />
          <button
            onClick={() => setIsExpanded(true)}
            className="nextjs__container_errors_expand_button"
            aria-expanded={isExpanded}
            aria-controls="nextjs__container_errors_desc"
          >
            Show More
          </button>
        </>
      )}
    </>
  )
}

export const styles = `
  .nextjs__container_errors_wrapper {
  }

  .nextjs__container_errors_desc {
    margin: 0;
    color: #ff006e;
    font-weight: 500;
    font-size: var(--size-16);
    letter-spacing: -0.32px;
    line-height: var(--size-24);
    overflow-wrap: break-word;
    white-space: pre-wrap;
  }

  .nextjs__container_errors_desc.nextjs__container_errors_desc_instant {
    color: var(--color-gray-1000);
  }

  .nextjs__container_errors_desc.truncated {
    max-height: 200px;
    overflow: hidden;
  }

  .nextjs__container_errors_desc code {
    font-family: var(--font-stack-monospace);
    font-weight: 500;
    line-height: var(--size-20);
    color: #00ffff;
    padding: 2px 6px;
    background: rgba(0, 255, 255, 0.08);
    border: 1px solid rgba(0, 255, 255, 0.2);
    border-radius: var(--rounded-md-2);
  }

  .nextjs__container_errors_gradient_overlay {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 85px;
    background: linear-gradient(
      180deg,
      rgba(0, 0, 0, 0) 0%,
      var(--color-background-100) 100%
    );
  }

  .nextjs__container_errors_expand_button {
    position: absolute;
    bottom: 10px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    padding: 6px 12px;
    background: var(--color-background-100);
    border: 1px solid rgba(0, 255, 255, 0.3);
    border-radius: var(--rounded-full);
    box-shadow:
      0px 2px 2px var(--color-gray-alpha-100),
      0px 8px 8px -8px var(--color-gray-alpha-100),
      0px 0px 8px rgba(0, 255, 255, 0.2);
    font-size: var(--size-13);
    cursor: pointer;
    color: #00ffff;
    font-weight: 500;
    transition: all 0.2s ease;
  }

  .nextjs__container_errors_expand_button:hover {
    background: rgba(0, 255, 255, 0.1);
    box-shadow:
      0px 2px 2px var(--color-gray-alpha-100),
      0px 8px 8px -8px var(--color-gray-alpha-100),
      0px 0px 16px rgba(0, 255, 255, 0.3);
  }
`
