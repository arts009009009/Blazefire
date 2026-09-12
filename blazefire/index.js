/**
 * Blazefire Framework - Error Overlay & DevTools
 * Powered by Frostfast compiler
 */

const React = require('react');

// Blazefire branded error overlay styles
const blazefireStyles = `
  :host {
    position: absolute;
    --color-font: #e0e0e0;
    --color-backdrop: rgba(0, 0, 0, 0.92);
    --color-border-shadow: rgba(0, 255, 255, 0.15);
    --color-title-color: #00ffff;
    --color-background-100: #000000;
    --color-background-200: #050505;
    --blazefire-cyan: #00ffff;
    --blazefire-magenta: #ff00ff;
    --blazefire-red: #ff006e;
    --blazefire-green: #00ff41;
    --blazefire-orange: #ff8800;
    --glow-cyan: 0 0 10px rgba(0, 255, 255, 0.3), 0 0 20px rgba(0, 255, 255, 0.1);
    --glow-magenta: 0 0 10px rgba(255, 0, 255, 0.3), 0 0 20px rgba(255, 0, 255, 0.1);
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

  .blazefire-error-label {
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(255, 0, 110, 0.15);
    font-weight: 600;
    font-size: 12px;
    color: #ff006e;
    border: 1px solid rgba(255, 0, 110, 0.3);
    text-shadow: 0 0 8px rgba(255, 0, 110, 0.5);
  }

  .blazefire-error-message {
    color: #ff006e;
    font-weight: 500;
    font-size: 16px;
    line-height: 24px;
  }

  .blazefire-error-message code {
    color: #00ffff;
    padding: 2px 6px;
    background: rgba(0, 255, 255, 0.08);
    border: 1px solid rgba(0, 255, 255, 0.2);
    border-radius: 4px;
  }

  .blazefire-dialog {
    background: #000000;
    border: 1px solid rgba(0, 255, 255, 0.2);
    border-radius: 8px;
  }

  .blazefire-expand-btn {
    padding: 6px 12px;
    background: #000000;
    border: 1px solid rgba(0, 255, 255, 0.3);
    border-radius: 9999px;
    color: #00ffff;
    cursor: pointer;
    box-shadow: 0 0 8px rgba(0, 255, 255, 0.2);
    transition: all 0.2s ease;
  }

  .blazefire-expand-btn:hover {
    background: rgba(0, 255, 255, 0.1);
    box-shadow: 0 0 16px rgba(0, 255, 255, 0.3);
  }
`;

/**
 * Blazefire Flame Logo SVG Component
 */
function BlazefireLogo({ size = 40, className = '' }) {
  return React.createElement('svg', {
    width: size,
    height: size,
    viewBox: '0 0 40 40',
    fill: 'none',
    className: className
  },
    React.createElement('defs', null,
      React.createElement('linearGradient', {
        id: 'blazefire_flame_gradient',
        x1: '20', y1: '5', x2: '20', y2: '35',
        gradientUnits: 'userSpaceOnUse'
      },
        React.createElement('stop', { stopColor: '#ff8800' }),
        React.createElement('stop', { offset: '0.4', stopColor: '#ff4400' }),
        React.createElement('stop', { offset: '0.7', stopColor: '#ff006e' }),
        React.createElement('stop', { offset: '1', stopColor: '#cc00cc' })
      ),
      React.createElement('filter', { id: 'blazefire_glow' },
        React.createElement('feGaussianBlur', { stdDeviation: '1', result: 'blur' }),
        React.createElement('feMerge', null,
          React.createElement('feMergeNode', { in: 'blur' }),
          React.createElement('feMergeNode', { in: 'SourceGraphic' })
        )
      )
    ),
    React.createElement('g', { filter: 'url(#blazefire_glow)' },
      React.createElement('path', {
        d: 'M20 3 C20 3 30 14 30 23 C30 28 25.5 32 20 32 C14.5 32 10 28 10 23 C10 14 20 3 20 3Z',
        fill: 'url(#blazefire_flame_gradient)'
      }),
      React.createElement('path', {
        d: 'M20 11 C20 11 25 18 25 23 C25 25.8 22.8 28 20 28 C17.2 28 15 25.8 15 23 C15 18 20 11 20 11Z',
        fill: 'url(#blazefire_flame_gradient)',
        opacity: '0.6'
      }),
      React.createElement('path', {
        d: 'M20 16 C20 16 22.5 20 22.5 23 C22.5 24.4 21.4 25.5 20 25.5 C18.6 25.5 17.5 24.4 17.5 23 C17.5 20 20 16 20 16Z',
        fill: '#ffcc00',
        opacity: '0.8'
      })
    )
  );
}

/**
 * Blazefire Error Overlay Header Component
 */
function BlazefireErrorHeader({ errorType, errorMessage }) {
  return React.createElement('div', { className: 'blazefire-error-overlay' },
    React.createElement('div', { className: 'blazefire-branding-header' },
      React.createElement(BlazefireLogo, { size: 28 }),
      React.createElement('span', { className: 'blazefire-branding-text' }, 'Blazefire')
    ),
    React.createElement('div', { className: 'blazefire-error-content' },
      React.createElement('span', { className: 'blazefire-error-label' }, errorType),
      React.createElement('div', { className: 'blazefire-error-message' }, errorMessage)
    )
  );
}

/**
 * Blazefire DevTools Indicator Component
 */
function BlazefireDevToolsIndicator({ isOpen, onClick }) {
  return React.createElement('button', {
    className: 'blazefire-devtools-button',
    onClick: onClick,
    'aria-label': `${isOpen ? 'Close' : 'Open'} Blazefire Dev Tools`,
    style: {
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      width: '40px',
      height: '40px',
      borderRadius: '50%',
      background: '#000000',
      border: '1px solid rgba(0, 255, 255, 0.3)',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: '0 0 10px rgba(0, 255, 255, 0.3)',
      zIndex: 2147483647
    }
  },
    React.createElement(BlazefireLogo, { size: 28 })
  );
}

/**
 * Insert Blazefire styles into document
 */
function insertBlazefireStyles() {
  if (typeof document !== 'undefined') {
    const existing = document.getElementById('blazefire-styles');
    if (!existing) {
      const style = document.createElement('style');
      style.id = 'blazefire-styles';
      style.textContent = blazefireStyles;
      document.head.appendChild(style);
    }
  }
}

/**
 * Frostfast Compiler Version
 */
const FROSTFAST_VERSION = '1.0.0';

/**
 * Default compiler options for Blazefire
 */
const defaultCompilerOptions = {
  jsc: {
    parser: {
      syntax: 'typescript',
      tsx: true,
      decorators: true,
    },
    transform: {
      react: {
        runtime: 'automatic',
      },
    },
  },
  module: {
    type: 'es6',
  },
};

/**
 * Create a Blazefire compiler instance
 */
function createCompiler(options = {}) {
  const mergedOptions = {
    ...defaultCompilerOptions,
    ...options,
  };

  return {
    options: mergedOptions,
    version: FROSTFAST_VERSION,
  };
}

// Export components and utilities
module.exports = {
  BlazefireLogo,
  BlazefireErrorHeader,
  BlazefireDevToolsIndicator,
  insertBlazefireStyles,
  blazefireStyles,
  createCompiler,
  FROSTFAST_VERSION,
  defaultCompilerOptions,
  version: '1.0.0'
};
