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
/* Drafting: Compose and Settings · Brand */
.st-page.st-wide { max-width: 1120px; }
.st-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.st-card { background: var(--stump-column); border: 1px solid var(--stump-line); border-radius: var(--stump-radius); padding: calc(var(--stump-space) * 3); margin: 0 0 calc(var(--stump-space) * 3); }
.st-card-head { display: flex; align-items: center; gap: 12px; margin: 0 0 calc(var(--stump-space) * 2) !important; font-size: var(--stump-size-section); font-weight: 620; }
.st-sub { display: flex; align-items: center; gap: 10px; font-size: var(--stump-size-body); font-weight: 600; margin: calc(var(--stump-space) * 3) 0 calc(var(--stump-space) * 1.5); }
.st-disc { width: 32px; height: 32px; flex: none; border-radius: 50%; background: var(--stump-accent); color: var(--stump-accent-text); display: inline-flex; align-items: center; justify-content: center; }
.st-disc svg { width: 17px; height: 17px; }
.st-disc.danger { background: var(--stump-danger); }
.st-textarea, .st-field textarea { font: inherit; color: var(--stump-text); background: var(--stump-column); width: 100%; box-sizing: border-box; border: 1px solid var(--stump-field); border-radius: 8px; padding: 12px 14px; resize: vertical; }
.st-textarea.large { font-size: 20px; line-height: 1.45; min-height: 128px; field-sizing: content; }
.st-textarea:focus, .st-field textarea:focus, .st-inline input:focus, .st-when input:focus, .st-chip:focus-visible, .st-icon:focus-visible, .st-variant-head:focus-visible, .st-checks-toggle:focus-visible { outline: 2px solid var(--stump-focus); outline-offset: 1px; }
.st-count { font-size: var(--stump-size-small); color: var(--stump-muted); text-align: right; margin-left: auto; white-space: nowrap; }
.st-count.over { color: var(--stump-danger); font-weight: 600; }
.st-source { display: flex; align-items: flex-end; gap: var(--stump-space); margin-top: calc(var(--stump-space) * 2); max-width: 520px; }
.st-source .st-field { flex: 1; }
.st-icon { font: inherit; font-size: 20px; line-height: 1; width: 40px; height: 40px; border: 0; border-radius: 50%; background: var(--stump-sunk); color: var(--stump-text); cursor: pointer; }
.st-chips { display: flex; flex-wrap: wrap; gap: var(--stump-space); }
.st-chip { font: inherit; font-size: var(--stump-size-small); border: 0; border-radius: 999px; padding: 8px 14px; min-height: 36px; background: var(--stump-sunk); color: var(--stump-text); cursor: pointer; }
.st-chip[aria-pressed="true"] { background: color-mix(in srgb, var(--stump-accent) 18%, var(--stump-column)); font-weight: 600; }
.st-chip:disabled { cursor: default; }
.st-open { margin-top: calc(var(--stump-space) * 3); }
.st-compose { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: calc(var(--stump-space) * 3); align-items: start; }
.st-compose > * { min-width: 0; }
.st-source-chip { display: inline-flex; align-items: center; gap: 12px; margin-top: calc(var(--stump-space) * 2); padding: 10px 18px 10px 12px; border-radius: 999px; background: color-mix(in srgb, var(--stump-accent) 12%, var(--stump-column)); overflow-wrap: anywhere; }
.st-source-chip .st-disc { width: 28px; height: 28px; }
.st-variants { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: calc(var(--stump-space) * 2); }
.st-variant { border: 1px solid var(--stump-line); border-radius: var(--stump-radius); padding: calc(var(--stump-space) * 2); background: var(--stump-column); min-width: 0; }
.st-variant:focus-within { border-color: var(--stump-focus); }
.st-variant.flagged { border-color: var(--stump-danger); background: color-mix(in srgb, var(--stump-danger) 5%, var(--stump-column)); }
.st-variant-head { font: inherit; display: flex; align-items: center; gap: var(--stump-space); width: 100%; background: none; border: 0; padding: 0 0 var(--stump-space); color: var(--stump-text); cursor: default; text-align: left; }
.st-variant textarea { font: inherit; font-size: var(--stump-size-body); color: var(--stump-text); width: 100%; box-sizing: border-box; border: 0; padding: 0; background: transparent; resize: none; field-sizing: content; min-height: 96px; outline: none; }
.st-flag-list { list-style: none; margin: var(--stump-space) 0 0; padding: 0; color: var(--stump-danger); font-size: var(--stump-size-small); }
.st-pill { display: inline-flex; align-items: center; font-size: var(--stump-size-small); border-radius: 999px; padding: 3px 10px; margin: 0 8px 0 0; background: color-mix(in srgb, var(--stump-accent) 14%, var(--stump-column)); color: var(--stump-text); text-decoration: none; white-space: nowrap; }
.st-pill.danger { background: color-mix(in srgb, var(--stump-danger) 12%, var(--stump-column)); color: var(--stump-danger); }
.st-pill.quiet { padding: 9px 16px; }
.st-check-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
.st-check-list li { display: flex; gap: 10px; align-items: flex-start; font-size: var(--stump-size-small); }
.st-check-list li .st-disc { width: 24px; height: 24px; }
.st-check-list li .st-disc svg { width: 14px; height: 14px; }
.st-check-list li.danger span:last-child { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
.st-checks-toggle { display: none; }
.st-bar { display: flex; align-items: center; gap: calc(var(--stump-space) * 2); flex-wrap: wrap; padding-top: calc(var(--stump-space) * 3); border-top: 1px solid var(--stump-line); }
.st-button.ink { background: var(--stump-text); color: var(--stump-column); font-weight: 600; border-radius: 999px; padding: 10px 24px; min-height: 44px; }
.st-when input { font: inherit; font-size: var(--stump-size-body); color: var(--stump-text); background: var(--stump-sunk); border: 1px solid transparent; border-radius: 999px; padding: 8px 16px; min-height: 44px; box-sizing: border-box; }
.st-tabs { display: flex; gap: calc(var(--stump-space) * 4); border-bottom: 1px solid var(--stump-line); margin: calc(var(--stump-space) * 2) 0 calc(var(--stump-space) * 3); overflow-x: auto; }
.st-tabs a { padding: 10px 0; color: var(--stump-muted); text-decoration: none; border-bottom: 2px solid transparent; white-space: nowrap; }
.st-tabs a[aria-current="page"] { color: var(--stump-text); font-weight: 600; border-bottom-color: var(--stump-accent); }
.st-kv { display: grid; grid-template-columns: minmax(160px, 260px) minmax(0, 1fr); gap: calc(var(--stump-space) * 2); padding: 14px 0; border-top: 1px solid var(--stump-line); align-items: center; }
.st-kv:first-child { border-top: 0; }
.st-inline { display: flex; align-items: center; gap: var(--stump-space); color: var(--stump-muted); }
.st-inline input { font: inherit; color: var(--stump-text); flex: 1; min-width: 0; border: 1px solid transparent; border-radius: 8px; padding: 6px 8px; background: transparent; }
.st-inline input:hover { border-color: var(--stump-line); }
.st-adder { margin-top: calc(var(--stump-space) * 2); padding-top: calc(var(--stump-space) * 2); border-top: 1px solid var(--stump-line); }
.st-add { margin-top: calc(var(--stump-space) * 2); }
.st-span { grid-column: 1 / -1; }
.st-saved { display: flex; justify-content: flex-end; }
@media (max-width: 760px) {
  .st-shell { grid-template-columns: 1fr; }
  .st-side { padding: calc(var(--stump-space) * 2) 16px; gap: 4px; flex-direction: row; flex-wrap: wrap; align-items: center; }
  .st-brand { width: 100%; margin-bottom: var(--stump-space); }
  .st-nav { flex-direction: row; flex-wrap: wrap; gap: 4px; }
  .st-nav-label { display: none; }
  .st-who { display: none; }
  .st-main { padding: calc(var(--stump-space) * 3) 16px; }
  .st-row { flex-wrap: wrap; }
}
@media (max-width: 760px) {
  .st-compose { grid-template-columns: 1fr; }
  .st-checks-toggle { display: flex; align-items: center; gap: 10px; font: inherit; width: 100%; background: none; border: 0; padding: 0; color: var(--stump-text); text-align: left; min-height: 44px; }
  .st-checks:not(.open) .st-card-head, .st-checks:not(.open) .st-check-list { display: none; }
  .st-checks.open .st-card-head { margin-top: calc(var(--stump-space) * 2) !important; }
  .st-variants { grid-template-columns: 1fr; }
  .st-variant-head { cursor: pointer; min-height: 44px; padding: 0; }
  .st-variant-body:not(.open) { display: none; }
  .st-bar { position: sticky; bottom: 0; z-index: 2; background: var(--stump-column); padding: 12px 0; gap: var(--stump-space); flex-wrap: nowrap; }
  .st-bar .st-button.ink { padding: 10px 16px; flex: none; white-space: nowrap; }
  .st-bar .st-when { flex: 1; min-width: 0; }
  .st-when input { padding: 8px 10px; width: 100%; font-size: var(--stump-size-small); }
  .st-bar > :nth-child(n+3) { display: none; }
  .st-kv { grid-template-columns: 1fr; gap: 4px; }
  .st-card { padding: calc(var(--stump-space) * 2); }
  .st-textarea.large { font-size: 18px; }
}
`
