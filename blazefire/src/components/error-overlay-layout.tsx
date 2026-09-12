import React from 'react';
import { BlazefireLogo } from './blazefire-logo';

export interface BlazefireErrorHeaderProps {
  errorType: string;
  errorMessage: React.ReactNode;
  children?: React.ReactNode;
}

export function BlazefireErrorHeader({
  errorType,
  errorMessage,
  children
}: BlazefireErrorHeaderProps): React.ReactElement {
  return (
    <div className="blazefire-error-overlay">
      <div className="blazefire-branding-header">
        <BlazefireLogo size={28} />
        <span className="blazefire-branding-text">Blazefire</span>
      </div>
      <div className="blazefire-error-content">
        <span className="blazefire-error-label">{errorType}</span>
        <div className="blazefire-error-message">{errorMessage}</div>
        {children}
      </div>
    </div>
  );
}

export interface BlazefireErrorOverlayProps {
  errorType: string;
  errorMessage: React.ReactNode;
  onClose?: () => void;
  children?: React.ReactNode;
}

export function BlazefireErrorOverlay({
  errorType,
  errorMessage,
  onClose,
  children
}: BlazefireErrorOverlayProps): React.ReactElement {
  return (
    <div
      className="blazefire-dialog"
      style={{
        position: 'fixed',
        top: '10vh',
        left: '50%',
        transform: 'translateX(-50%)',
        maxWidth: '90vw',
        maxHeight: '80vh',
        overflow: 'auto',
        zIndex: 2147483647
      }}
    >
      <BlazefireErrorHeader errorType={errorType} errorMessage={errorMessage}>
        {children}
      </BlazefireErrorHeader>
      {onClose && (
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '12px',
            right: '12px',
            background: 'none',
            border: 'none',
            color: '#666',
            cursor: 'pointer',
            fontSize: '18px'
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
