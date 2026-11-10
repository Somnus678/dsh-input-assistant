export const STYLE_TEXT = `
.dsh-ia {
  --dsh-ia-fallback-bg: #ffffff;
  --dsh-ia-fallback-fg: #111827;
  --dsh-ia-fallback-muted: #4b5563;
  --dsh-ia-fallback-border: #d1d5db;
  --dsh-ia-accent: var(--dsw-alias-state-business-primary, #3b82f6);
  --dsh-ia-accent-subtle: rgba(59, 130, 246, 0.1);
  --dsh-ia-pill-bg: var(--dsw-alias-interactive-bg-subtle, rgba(0, 0, 0, 0.04));
  --dsh-ia-pill-hover: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.08));
  font-family: var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
  color: var(--dsw-alias-label-primary, var(--dsh-ia-fallback-fg));
  font-size: 13px;
  line-height: 1.5;
  box-sizing: border-box;
  color-scheme: light;
}

body[data-ds-dark-theme] .dsh-ia {
  --dsh-ia-fallback-bg: #1f2329;
  --dsh-ia-fallback-fg: #f3f4f6;
  --dsh-ia-fallback-muted: #9ca3af;
  --dsh-ia-fallback-border: #374151;
  --dsh-ia-pill-bg: var(--dsw-alias-interactive-bg-subtle, rgba(255, 255, 255, 0.06));
  --dsh-ia-pill-hover: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.12));
  color-scheme: dark;
}

.dsh-ia * { box-sizing: border-box; }
.dsh-ia button, .dsh-ia input, .dsh-ia select { font: inherit; color: inherit; }

/* Global buttons within dsh-ia */
.dsh-ia button {
  border: 1px solid var(--dsw-alias-border-l2, var(--dsh-ia-fallback-border));
  border-radius: 7px;
  padding: 5px 11px;
  background: var(--dsw-alias-bg-layer-1, transparent);
  color: var(--dsw-alias-label-primary, inherit);
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, opacity 0.15s ease, transform 0.15s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
}
.dsh-ia button:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, #8882);
  border-color: var(--dsw-alias-state-business-primary, var(--dsh-ia-accent));
}
.dsh-ia button:active:not(:disabled) {
  transform: translateY(1px);
}
.dsh-ia button:disabled {
  opacity: 0.45;
  cursor: default;
  transform: none;
}
.dsh-ia button:focus-visible, .dsh-ia input:focus-visible, .dsh-ia select:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #3b82f6);
  outline-offset: 2px;
}

/* Smart Pill Trigger Group in Input Card */
.dsh-ia-root {
  display: inline-flex;
  align-items: center;
  background: var(--dsh-ia-pill-bg);
  border: 1px solid var(--dsw-alias-border-l2, var(--dsh-ia-fallback-border));
  border-radius: 8px;
  padding: 2px;
  gap: 2px;
  position: relative;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}
.dsh-ia-root .dsh-ia-trigger {
  border: none;
  background: transparent;
  padding: 4px 10px;
  font-weight: 500;
  border-radius: 6px;
  white-space: nowrap;
}
.dsh-ia-root .dsh-ia-trigger:hover:not(:disabled) {
  background: var(--dsh-ia-pill-hover);
}
.dsh-ia-root .dsh-ia-menu-btn {
  border: none;
  background: transparent;
  padding: 4px 6px;
  border-radius: 6px;
  min-width: 24px;
}
.dsh-ia-root .dsh-ia-menu-btn:hover:not(:disabled) {
  background: var(--dsh-ia-pill-hover);
}
.dsh-ia-root .dsh-ia-cancel-btn {
  border: none;
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 6px;
}
.dsh-ia-root .dsh-ia-cancel-btn:hover {
  background: rgba(239, 68, 68, 0.2);
}

/* Floating Menu Panel */
.dsh-ia-menu {
  position: fixed;
  width: min(480px, calc(100vw - 24px));
  max-height: calc(100dvh - 24px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 16px;
  border: 1px solid var(--dsw-alias-border-l2, var(--dsh-ia-fallback-border));
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-2, var(--dsh-ia-fallback-bg));
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.22);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.dsh-ia-preview {
  z-index: 1001;
  width: min(580px, calc(100vw - 24px));
}
.dsh-ia-preview .dsh-ia-pre {
  margin-top: 10px;
  max-height: 360px;
}

/* Form Controls & Fields */
.dsh-ia-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin: 6px 0;
}
.dsh-ia-row label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
}
.dsh-ia-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin: 6px 0;
}
.dsh-ia-field input, .dsh-ia select {
  border: 1px solid var(--dsw-alias-border-l2, var(--dsh-ia-fallback-border));
  border-radius: 7px;
  background: var(--dsw-alias-bg-layer-1, var(--dsh-ia-fallback-bg));
  padding: 7px 10px;
  color: var(--dsw-alias-label-primary, inherit);
  transition: border-color 0.15s ease;
}
.dsh-ia-field input:focus, .dsh-ia select:focus {
  border-color: var(--dsw-alias-state-business-primary, var(--dsh-ia-accent));
}
.dsh-ia-field input { width: 100%; }
.dsh-ia-muted {
  color: var(--dsw-alias-label-secondary, var(--dsh-ia-fallback-muted));
  font-size: 12px;
  line-height: 1.45;
}

/* Sections */
.dsh-ia-section {
  border-top: 1px solid var(--dsw-alias-border-l2, var(--dsh-ia-fallback-border));
  margin-top: 8px;
  padding-top: 10px;
}
.dsh-ia-section h4 {
  font-size: 13px;
  margin: 0 0 8px;
  font-weight: 600;
}

/* Notices & Alerts */
.dsh-ia-notice {
  position: fixed;
  max-width: min(360px, calc(100vw - 32px));
  overflow: auto;
  padding: 6px 12px;
  background: var(--dsw-alias-bg-layer-2, var(--dsh-ia-fallback-bg));
  border: 1px solid var(--dsw-alias-border-l2, var(--dsh-ia-fallback-border));
  border-radius: 20px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.14);
  z-index: 1002;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  animation: dshIaFadeIn 0.2s ease-out;
}
@keyframes dshIaFadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
.dsh-ia-menu .dsh-ia-notice {
  position: static;
  max-width: 100%;
  margin: 6px 0;
  box-shadow: none;
}
.dsh-ia-notice button { margin-left: 6px; padding: 3px 8px; font-size: 11px; }

/* Diff / Pre formatting */
.dsh-ia-pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
  font-size: 12px;
  max-height: 200px;
  overflow-y: auto;
  padding: 10px;
  border: 1px solid var(--dsw-alias-border-l2, var(--dsh-ia-fallback-border));
  border-radius: 8px;
  background: var(--dsw-alias-bg-module-platform, rgba(128, 128, 128, 0.08));
}
.dsh-ia-diff ins {
  background: rgba(39, 163, 91, 0.22);
  color: #107c41;
  text-decoration: none;
  border-radius: 2px;
  padding: 0 2px;
}
body[data-ds-dark-theme] .dsh-ia-diff ins {
  color: #4ade80;
  background: rgba(34, 197, 94, 0.22);
}
.dsh-ia-diff del {
  background: rgba(217, 69, 69, 0.22);
  color: #c42b1c;
  text-decoration: line-through;
  border-radius: 2px;
  padding: 0 2px;
}
body[data-ds-dark-theme] .dsh-ia-diff del {
  color: #f87171;
  background: rgba(239, 68, 68, 0.22);
}

/* Draft Card */
.dsh-ia-draft {
  border: 1px solid var(--dsw-alias-border-l2, var(--dsh-ia-fallback-border));
  border-radius: 9px;
  padding: 9px 12px;
  margin: 8px 0;
  background: var(--dsw-alias-bg-layer-1, transparent);
  transition: border-color 0.15s ease;
}
.dsh-ia-draft summary {
  cursor: pointer;
  overflow-wrap: anywhere;
  font-weight: 500;
}
.dsh-ia-draft time {
  display: block;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, var(--dsh-ia-fallback-muted));
  margin: 3px 0 6px;
}

/* Candidate Panel & Ghost Text */
.dsh-ia-candidate {
  position: fixed;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 14px;
  max-width: min(640px, calc(100vw - 32px));
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid var(--dsw-alias-border-l2, var(--dsh-ia-fallback-border));
  border-radius: 11px;
  background: var(--dsw-alias-bg-layer-2, var(--dsh-ia-fallback-bg));
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.2);
  pointer-events: auto;
  z-index: 998;
}
.dsh-ia-candidate-text {
  flex: 1;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 13px;
  line-height: 1.5;
}
.dsh-ia-ghost {
  position: fixed;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: break-word;
  overflow: hidden;
  max-height: 100%;
  pointer-events: none;
  user-select: none;
  color: var(--dsw-alias-label-tertiary, #76808d);
  opacity: 0.88;
  z-index: 34;
}
[data-composer-card]:has([data-dsh-ia-empty-ghost]) [data-composer-placeholder] {
  visibility: hidden;
}

/* Settings Form page */
.dsh-ia-settings { width: 100%; max-width: 760px; }
.dsh-ia-settings h2 { font-size: 18px; margin: 0 0 8px; }
.dsh-ia-settings h3 { font-size: 14px; margin: 0 0 10px; font-weight: 600; }
.dsh-ia-settings fieldset { padding: 0; margin: 0; border: 0; min-width: 0; }
.dsh-ia-settings-toggles { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
.dsh-ia-settings-toggles label { display: flex; align-items: center; gap: 7px; cursor: pointer; }
.dsh-ia-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

.dsh-ia-preview .dsh-ia-pre { max-height: 320px; }
.dsh-ia-notice { flex-wrap: wrap; border-radius: 12px; }
.dsh-ia-route, .dsh-ia-suggestion-state { overflow-wrap: anywhere; }
.dsh-ia-suggestion-state { margin: 6px 0; }
.dsh-ia-inline-status { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--dsw-alias-label-secondary,var(--dsh-ia-fallback-muted)); }
.dsh-ia summary:focus-visible { outline: 2px solid var(--dsh-ia-accent); outline-offset: 2px; }
.dsh-ia-settings-presets { display: grid; grid-template-columns: repeat(auto-fit,minmax(180px,1fr)); gap: 10px; }
.dsh-ia .dsh-ia-preset { display: flex; flex-direction: column; align-items: flex-start; text-align: left; padding: 12px; gap: 5px; }
.dsh-ia .dsh-ia-preset[aria-pressed=true] { border-color: var(--dsh-ia-accent); background: var(--dsh-ia-accent-subtle); }
.dsh-ia-setting-grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(min(280px,100%),1fr)); gap: 14px; margin-top: 12px; }
.dsh-ia-number-control { display: flex; align-items: center; gap: 10px; }
.dsh-ia-number-control input[type=number] { width: 100px; flex: 0 0 auto; }
.dsh-ia-number-control input[type=range] { min-width: 0; flex: 1; accent-color: var(--dsh-ia-accent); }
.dsh-ia-setting-heading { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
.dsh-ia-setting-heading label { font-weight: 500; }
@media (prefers-reduced-motion: reduce) { .dsh-ia *, .dsh-ia-notice { transition: none !important; animation: none !important; } }
`
