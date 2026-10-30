import branding from '../../branding.json'

// The signed-in app's look, all in tokens so the 12ui pass can restyle it in
// one place. Built on Base's --rer-* theme (public/rer-theme.css).
export const appStyles = `
:root {
  --stump-accent: var(--rer-accent, ${branding.primaryColor});
  --stump-accent-text: var(--rer-accent-text, #ffffff);
  --stump-canvas: var(--rer-page, #f4f6f5);
  --stump-column: #ffffff;
  --stump-sunk: #f2f4f3;
  --stump-text: var(--rer-text, #1b2724);
  --stump-muted: var(--rer-muted, #4a5a55);
  --stump-line: #dfe5e2;
  --stump-field: var(--rer-border, #6b7c76);
  --stump-focus: var(--rer-focus, #1b2724);
  --stump-danger: #a3332b;
  --stump-radius: 10px;
  --stump-font: var(--rer-font-body, Outfit, Arial, sans-serif);
  --stump-size-small: 13px;
  --stump-size-body: 15px;
  --stump-size-section: 18px;
  --stump-size-title: 26px;
  --stump-space: 8px;
}
body { margin: 0; padding: 0; background: var(--stump-canvas); color: var(--stump-text); font: var(--stump-size-body)/1.5 var(--stump-font); }
.st-shell { display: grid; grid-template-columns: 232px minmax(0, 1fr); min-height: 100vh; }
.st-side { padding: calc(var(--stump-space) * 3) calc(var(--stump-space) * 2); display: flex; flex-direction: column; gap: calc(var(--stump-space) * 3); }
.st-brand { display: flex; align-items: center; gap: var(--stump-space); font-weight: 650; font-size: var(--stump-size-section); color: inherit; text-decoration: none; }
.st-brand img { width: 28px; height: 28px; }
.st-nav { display: flex; flex-direction: column; gap: 2px; }
.st-nav-label { font-size: var(--stump-size-small); color: var(--stump-muted); padding: 0 calc(var(--stump-space) * 1.5); margin-bottom: 4px; }
.st-nav a { display: block; padding: 7px calc(var(--stump-space) * 1.5); border-radius: var(--stump-radius); color: var(--stump-text); text-decoration: none; }
.st-nav a:hover { background: var(--stump-sunk); }
.st-nav a[aria-current="page"], .st-nav a.active { background: var(--stump-column); font-weight: 600; }
.st-who { margin-top: auto; font-size: var(--stump-size-small); color: var(--stump-muted); padding: 0 calc(var(--stump-space) * 1.5); }
.st-main { background: var(--stump-column); min-width: 0; padding: calc(var(--stump-space) * 5) calc(var(--stump-space) * 6); }
.st-page { max-width: 860px; }
.st-page h1 { font-size: var(--stump-size-title); line-height: 1.2; margin: 0 0 calc(var(--stump-space) * 1); font-weight: 650; }
.st-lead { color: var(--stump-muted); margin: 0 0 calc(var(--stump-space) * 4); }
.st-page h2 { font-size: var(--stump-size-section); margin: calc(var(--stump-space) * 5) 0 calc(var(--stump-space) * 1.5); font-weight: 620; }
.st-list { list-style: none; margin: 0; padding: 0; }
.st-row { display: flex; align-items: center; gap: calc(var(--stump-space) * 2); padding: calc(var(--stump-space) * 1.5) 0; border-top: 1px solid var(--stump-line); }
.st-row:first-child { border-top: 0; }
.st-row-main { flex: 1 1 240px; min-width: 0; }
.st-name { font-weight: 560; overflow-wrap: anywhere; }
.st-meta { font-size: var(--stump-size-small); color: var(--stump-muted); overflow-wrap: anywhere; }
.st-actions { display: flex; gap: var(--stump-space); align-items: center; flex-wrap: wrap; }
.st-panel { background: var(--stump-sunk); border-radius: var(--stump-radius); padding: calc(var(--stump-space) * 2.5); margin: calc(var(--stump-space) * 2) 0; }
.st-status { display: flex; align-items: center; gap: calc(var(--stump-space) * 2); flex-wrap: wrap; justify-content: space-between; background: var(--stump-sunk); border-radius: var(--stump-radius); padding: calc(var(--stump-space) * 3); }
.st-status strong { font-size: var(--stump-size-section); }
.st-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: var(--stump-accent); margin-right: var(--stump-space); }
.st-dot.paused { background: var(--stump-danger); }
.st-dot.off { background: var(--stump-line); }
.st-box { border: 1px solid var(--stump-line); border-radius: var(--stump-radius); padding: 0 calc(var(--stump-space) * 2.5); background: var(--stump-column); }
.st-box .st-row { padding: calc(var(--stump-space) * 2) 0; }
.st-row-toggle { font: inherit; color: inherit; background: none; border: 0; padding: 0; text-align: left; cursor: pointer; display: flex; align-items: center; gap: calc(var(--stump-space) * 2); width: 100%; min-height: 44px; }
.st-row-toggle:focus-visible { outline: 2px solid var(--stump-focus); outline-offset: 2px; border-radius: 6px; }
.st-state { display: flex; align-items: center; font-size: var(--stump-size-small); color: var(--stump-muted); flex: 0 1 260px; min-width: 0; }
.st-row.st-stack { display: block; }
.st-chevron { font-size: var(--stump-size-section); color: var(--stump-muted); transition: transform .15s; }
.st-row-toggle[aria-expanded="true"] .st-chevron { transform: rotate(90deg); }
.st-handle { display: block; font-size: var(--stump-size-section); font-weight: 600; }
.st-spaced { margin-top: calc(var(--stump-space) * 1.5); }
.st-field.st-check { flex-direction: row; align-items: center; gap: var(--stump-space); color: var(--stump-text); }
.st-field.st-check input { min-height: 0; }
.st-days { display: flex; flex-wrap: wrap; gap: 4px; }
.st-days label { display: inline-flex; align-items: center; gap: 4px; font-size: var(--stump-size-small); color: var(--stump-text); min-height: 32px; padding: 0 8px; background: var(--stump-sunk); border-radius: 8px; }
.st-form { display: grid; gap: calc(var(--stump-space) * 2); grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); align-items: end; }
.st-field { display: flex; flex-direction: column; gap: 4px; font-size: var(--stump-size-small); color: var(--stump-muted); }
.st-field input, .st-field select, .st-select { font: inherit; font-size: var(--stump-size-body); color: var(--stump-text); background: var(--stump-column); border: 1px solid var(--stump-field); border-radius: 8px; padding: 8px 10px; min-height: 40px; box-sizing: border-box; }
.st-field input:focus, .st-field select:focus, .st-select:focus, .st-button:focus-visible, .st-nav a:focus-visible { outline: 2px solid var(--stump-focus); outline-offset: 1px; }
.st-button { font: inherit; font-size: var(--stump-size-body); border: 0; border-radius: 8px; padding: 9px 16px; min-height: 40px; cursor: pointer; background: var(--stump-sunk); color: var(--stump-text); }
.st-button.primary { background: var(--stump-accent); color: var(--stump-accent-text); font-weight: 600; }
.st-button.danger { color: var(--stump-danger); background: transparent; }
.st-button:disabled { opacity: .55; cursor: default; }
.st-note, .st-error { margin: 4px 0 0; }
.st-note:empty, .st-error:empty { margin: 0; }
.st-note { font-size: var(--stump-size-small); color: var(--stump-muted); }
.st-error { color: var(--stump-danger); font-size: var(--stump-size-small); }
.st-secret { font-family: ui-monospace, Menlo, monospace; font-size: var(--stump-size-small); background: var(--stump-column); border-radius: 8px; padding: 10px; overflow-wrap: anywhere; user-select: all; }
.st-tip { position: relative; display: inline-flex; }
.st-tip [role="tooltip"] { position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%); white-space: nowrap; background: var(--stump-text); color: var(--stump-column); font-size: var(--stump-size-small); padding: 4px 8px; border-radius: 6px; pointer-events: none; opacity: 0; transition: opacity .1s; }
.st-tip:hover [role="tooltip"] { opacity: 1; transition-delay: .3s; }
.st-tip:focus-within [role="tooltip"] { opacity: 1; transition-delay: 0s; }
@media (max-width: 760px) {
  .st-shell { grid-template-columns: 1fr; }
  .st-side { padding: calc(var(--stump-space) * 2) 16px; gap: 4px; flex-direction: row; flex-wrap: wrap; align-items: center; }
  .st-brand { width: 100%; margin-bottom: var(--stump-space); }
  .st-nav { flex-direction: row; flex-wrap: wrap; gap: 4px; }
  .st-nav-label { display: none; }
  .st-who { display: none; }
  .st-main { padding: calc(var(--stump-space) * 3) 16px; }
  .st-row { flex-wrap: wrap; }
  .st-row-toggle { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px var(--stump-space); }
  .st-row-toggle .st-state { grid-column: 1; grid-row: 2; }
  .st-row-toggle .st-chevron { grid-column: 2; grid-row: 1 / span 2; align-self: center; }
}
`
