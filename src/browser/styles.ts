export const STYLE_TEXT = `
.dsh-ia {--dsh-ia-fallback-bg:#fff;--dsh-ia-fallback-fg:#0f1115;--dsh-ia-fallback-muted:#61666b;--dsh-ia-fallback-border:#d7dce2;font-family:var(--dsw-font-family,system-ui,sans-serif);color:var(--dsw-alias-label-primary,var(--dsh-ia-fallback-fg));font-size:13px;line-height:1.5;box-sizing:border-box;color-scheme:light}
body[data-ds-dark-theme] .dsh-ia {--dsh-ia-fallback-bg:#232324;--dsh-ia-fallback-fg:#f3f4f6;--dsh-ia-fallback-muted:#adb2b8;--dsh-ia-fallback-border:#43454a;color-scheme:dark}
.dsh-ia * {box-sizing:border-box}
.dsh-ia button,.dsh-ia input,.dsh-ia select {font:inherit;color:inherit}
.dsh-ia button {border:1px solid var(--dsw-alias-border-l2,var(--dsh-ia-fallback-border));border-radius:7px;padding:5px 9px;background:transparent;cursor:pointer}
.dsh-ia button:hover:not(:disabled) {background:var(--dsw-alias-interactive-bg-hover,#8882)}
.dsh-ia button:disabled {opacity:.45;cursor:default}
.dsh-ia button:focus-visible,.dsh-ia input:focus-visible,.dsh-ia select:focus-visible {outline:2px solid var(--dsw-alias-state-business-primary,#4c88e4);outline-offset:2px}
.dsh-ia-root {display:flex;align-items:center;gap:3px;position:relative}
.dsh-ia-settings {width:100%;max-width:760px}
.dsh-ia-settings h2 {font-size:18px;margin:0 0 8px}.dsh-ia-settings h3 {font-size:14px;margin:0 0 10px}
.dsh-ia-settings fieldset {padding:0;margin:0;border:0;min-width:0}
.dsh-ia-settings-toggles {display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.dsh-ia-settings-toggles label {display:flex;align-items:center;gap:7px}
.dsh-ia-trigger {white-space:nowrap}
.dsh-ia-menu {position:fixed;width:min(440px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow:auto;overscroll-behavior:contain;padding:14px;border:1px solid var(--dsw-alias-border-l2,var(--dsh-ia-fallback-border));border-radius:12px;background:var(--dsw-alias-bg-layer-2,var(--dsh-ia-fallback-bg));box-shadow:0 8px 32px #0003;z-index:1000}
.dsh-ia-row {display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 0}
.dsh-ia-row label {display:flex;align-items:center;gap:6px}
.dsh-ia-field {display:flex;flex-direction:column;gap:4px;margin:8px 0}
.dsh-ia-field input,.dsh-ia select {border:1px solid var(--dsw-alias-border-l2,var(--dsh-ia-fallback-border));border-radius:6px;background:var(--dsw-alias-bg-layer-1,var(--dsh-ia-fallback-bg));padding:6px}
.dsh-ia-field input {width:100%}
.dsh-ia-muted {color:var(--dsw-alias-label-secondary,var(--dsh-ia-fallback-muted));font-size:12px}
.dsh-ia-notice {position:fixed;max-width:calc(100vw - 24px);overflow:auto;padding:8px 11px;background:var(--dsw-alias-bg-layer-2,var(--dsh-ia-fallback-bg));border:1px solid var(--dsw-alias-border-l2,var(--dsh-ia-fallback-border));border-radius:9px;box-shadow:0 4px 18px #0002;z-index:999}
.dsh-ia-menu .dsh-ia-notice {position:static;max-width:100%;margin:8px 0;box-shadow:none}
.dsh-ia-section {border-top:1px solid var(--dsw-alias-border-l2,var(--dsh-ia-fallback-border));margin-top:12px;padding-top:10px}
.dsh-ia-section h4 {font-size:13px;margin:0 0 8px}
.dsh-ia-pre {white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;font-size:12px;max-height:190px;overflow:auto;padding:9px;border:1px solid var(--dsw-alias-border-l2,var(--dsh-ia-fallback-border));border-radius:7px;background:var(--dsw-alias-bg-module-platform,#8881)}
.dsh-ia-diff ins {background:#27a35b26;text-decoration:none}.dsh-ia-diff del {background:#d9454526}
.dsh-ia-draft {border:1px solid var(--dsw-alias-border-l2,var(--dsh-ia-fallback-border));border-radius:8px;padding:8px;margin:7px 0}
.dsh-ia-draft summary {cursor:pointer;overflow-wrap:anywhere}
.dsh-ia-draft time {font-size:11px;opacity:.65}
.dsh-ia-candidate {position:fixed;display:flex;align-items:center;gap:8px;padding:9px 12px;overflow:auto;border:1px solid var(--dsw-alias-border-l2,var(--dsh-ia-fallback-border));border-radius:10px;background:var(--dsw-alias-bg-layer-2,var(--dsh-ia-fallback-bg));box-shadow:0 4px 16px #0002;pointer-events:auto;z-index:998}
.dsh-ia-candidate-text {flex:1;white-space:pre-wrap;overflow-wrap:anywhere}
.dsh-ia-ghost {position:fixed;white-space:pre-wrap;overflow-wrap:anywhere;overflow:hidden;max-height:3lh;pointer-events:none;user-select:none;color:var(--dsw-alias-label-tertiary,#76808d);opacity:.9;z-index:34}
[data-composer-card]:has([data-dsh-ia-empty-ghost]) [data-composer-placeholder] {visibility:hidden}
`
