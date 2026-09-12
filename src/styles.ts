/**
 * Blazefire Cyberpunk/OLED Dark Theme Styles
 */

export const blazefireStyles = `
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
    --glow-red: 0 0 10px rgba(255, 0, 110, 0.3), 0 0 20px rgba(255, 0, 110, 0.1);
    --glow-green: 0 0 10px rgba(0, 255, 65, 0.3), 0 0 20px rgba(0, 255, 65, 0.1);
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

  .blazefire-error-label-blocking {
    background: rgba(0, 255, 255, 0.15);
    color: #00ffff;
    border-color: rgba(0, 255, 255, 0.3);
    text-shadow: 0 0 8px rgba(0, 255, 255, 0.5);
  }

  .blazefire-error-label-warning {
    background: rgba(255, 136, 0, 0.15);
    color: #ffaa00;
    border-color: rgba(255, 136, 0, 0.3);
    text-shadow: 0 0 8px rgba(255, 136, 0, 0.5);
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
    box-shadow: 0 0 20px rgba(0, 255, 255, 0.1);
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

  .blazefire-scrollbar::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }

  .blazefire-scrollbar::-webkit-scrollbar-track {
    background: #000000;
  }

  .blazefire-scrollbar::-webkit-scrollbar-thumb {
    background: linear-gradient(180deg, #00ffff, #ff00ff);
    border-radius: 3px;
  }
`;

export function insertBlazefireStyles(): void {
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
