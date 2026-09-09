export type ErrorType =
  | 'Build Error'
  | `Runtime ${string}`
  | `Console ${string}`
  | `Recoverable ${string}`
  | 'Blocking Route'
  | 'Ambiguous Metadata'
  | 'Instant'

type ErrorTypeLabelProps = {
  errorType: ErrorType
}

export function ErrorTypeLabel({ errorType }: ErrorTypeLabelProps) {
  return (
    <span
      id="nextjs__container_errors_label"
      className={`nextjs__container_errors_label ${errorType === 'Ambiguous Metadata' ? 'nextjs__container_errors_label_blocking_page' : ''} ${errorType === 'Instant' ? 'nextjs__container_errors_label_instant' : ''}`}
    >
      {errorType}
    </span>
  )
}

export const styles = `
  .nextjs__container_errors_label {
    padding: 2px 6px;
    margin: 0;
    border-radius: var(--rounded-md-2);
    background: rgba(255, 0, 110, 0.15);
    font-weight: 600;
    font-size: var(--size-12);
    color: #ff006e;
    font-family: var(--font-stack-monospace);
    line-height: var(--size-20);
    border: 1px solid rgba(255, 0, 110, 0.3);
    text-shadow: 0 0 8px rgba(255, 0, 110, 0.5);
  }

  .nextjs__container_errors_label_blocking_page {
    background: rgba(0, 255, 255, 0.15);
    color: #00ffff;
    border-color: rgba(0, 255, 255, 0.3);
    text-shadow: 0 0 8px rgba(0, 255, 255, 0.5);
  }

  .nextjs__container_errors_label_instant {
    background: rgba(255, 136, 0, 0.15);
    color: #ffaa00;
    border-color: rgba(255, 136, 0, 0.3);
    text-shadow: 0 0 8px rgba(255, 136, 0, 0.5);
  }
`
