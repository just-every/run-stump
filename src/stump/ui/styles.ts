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

/* Venues: toolbar, table, chips, cards and the two-column detail (src/routes/app.venues.*). */
:root {
  --stump-accent-tint: #e7f0e8;
  --stump-accent-ink: #08724f;
  --stump-held: #8a4a1c;
  --stump-held-tint: #f6eadf;
  --stump-danger-tint: #fdecea;
  --stump-radius-card: 14px;
}
.st-sub { color: var(--stump-muted); margin: 0 0 calc(var(--stump-space) * 4); }
.st-toolbar { display: flex; gap: calc(var(--stump-space) * 1.5); align-items: center; flex-wrap: wrap; margin-bottom: calc(var(--stump-space) * 2); }
.st-toolbar .st-grow { flex: 1 1 260px; max-width: 480px; }
.st-search { font: inherit; font-size: var(--stump-size-body); width: 100%; box-sizing: border-box; min-height: 44px; padding: 8px 14px; border: 1px solid var(--stump-field); border-radius: 10px; background: var(--stump-column); color: var(--stump-text); }
.st-search:focus { outline: 2px solid var(--stump-focus); outline-offset: 1px; }
.st-toolbar .st-end { margin-left: auto; }
.st-button.pill { border-radius: 999px; }
.st-button.outline { background: var(--stump-column); border: 1px solid var(--stump-line); }
.st-chips { display: flex; gap: var(--stump-space); flex-wrap: wrap; margin-bottom: calc(var(--stump-space) * 2); }
.st-chip { display: inline-flex; align-items: center; gap: 6px; min-height: 26px; padding: 0 10px; border-radius: 999px; font-size: var(--stump-size-small); font-weight: 500; background: var(--stump-sunk); color: var(--stump-muted); white-space: nowrap; border: 0; font-family: inherit; }
.st-chip.ok { background: var(--stump-accent-tint); color: var(--stump-accent-ink); }
.st-chip.held { background: var(--stump-held-tint); color: var(--stump-held); }
.st-chip.danger { background: var(--stump-danger-tint); color: var(--stump-danger); }
button.st-chip { cursor: pointer; }
.st-chip .st-dot { width: 8px; height: 8px; margin: 0; }
.st-dot.open { background: transparent; box-shadow: inset 0 0 0 1.5px currentColor; }
.st-table { width: 100%; border-collapse: separate; border-spacing: 0; border: 1px solid var(--stump-line); border-radius: var(--stump-radius-card); overflow: hidden; }
.st-table th { text-align: left; font-size: var(--stump-size-small); font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--stump-muted); background: var(--stump-sunk); padding: 12px 16px; }
.st-table td { padding: 0 16px; height: 56px; border-top: 1px solid var(--stump-line); vertical-align: middle; }
.st-table tbody tr { cursor: pointer; }
.st-table tbody tr:hover td { background: var(--stump-sunk); }
.st-table a { color: inherit; text-decoration: none; font-weight: 560; }
.st-table a:focus-visible { outline: 2px solid var(--stump-focus); outline-offset: 2px; }
.st-rowline { display: none; }
.st-card { background: var(--stump-column); border: 1px solid var(--stump-line); border-radius: var(--stump-radius-card); padding: calc(var(--stump-space) * 3); margin-bottom: calc(var(--stump-space) * 2); min-width: 0; }
.st-card h2 { margin: 0 0 calc(var(--stump-space) * 1.5); }
.st-columns { display: grid; grid-template-columns: minmax(0, 1fr) 360px; column-gap: calc(var(--stump-space) * 3); align-items: start; }
.st-columns > .st-aside { grid-column: 2; grid-row: 1 / span 2; }
.st-menu .st-tip [role="tooltip"] { left: auto; right: 0; transform: none; }
.st-back { display: inline-block; color: var(--stump-muted); text-decoration: none; margin-bottom: calc(var(--stump-space) * 2); }
.st-back:hover { color: var(--stump-text); }
.st-rule { display: grid; grid-template-columns: 150px minmax(0, 1fr) auto; gap: calc(var(--stump-space) * 2); align-items: center; padding: 14px 0; border-top: 1px solid var(--stump-line); }
.st-rule:first-of-type { border-top: 0; }
.st-rule-label { font-weight: 600; }
.st-rule-source { font-size: var(--stump-size-small); color: var(--stump-muted); white-space: nowrap; }
.st-rule-source a { color: var(--stump-accent-ink); }
.st-value { font: inherit; text-align: left; background: none; border: 0; padding: 4px 0; color: var(--stump-text); cursor: pointer; min-height: 32px; }
.st-value:hover { text-decoration: underline; }
.st-value:focus-visible { outline: 2px solid var(--stump-focus); outline-offset: 2px; }
.st-empty { text-align: center; padding: calc(var(--stump-space) * 8) 0; }
.st-empty h2 { font-size: 24px; font-weight: 800; margin: 0 0 var(--stump-space); }
.st-empty p { color: var(--stump-muted); margin: 0 0 calc(var(--stump-space) * 3); }
.st-empty .st-actions { justify-content: center; }
.st-menu { position: relative; }
.st-menu [role="menu"] { position: absolute; right: 0; top: calc(100% + 6px); background: var(--stump-column); border: 1px solid var(--stump-line); border-radius: 12px; padding: 6px; min-width: 180px; z-index: 5; box-shadow: 0 12px 40px -12px rgba(28,27,24,.28); }
.st-menu [role="menuitem"] { display: block; width: 100%; text-align: left; font: inherit; background: none; border: 0; padding: 10px 12px; border-radius: 8px; cursor: pointer; color: var(--stump-text); }
.st-menu [role="menuitem"]:hover, .st-menu [role="menuitem"]:focus-visible { background: var(--stump-sunk); outline: none; }
.st-kv { display: grid; grid-template-columns: 140px minmax(0, 1fr); gap: 6px calc(var(--stump-space) * 2); margin: 0; }
.st-kv dt { color: var(--stump-muted); }
.st-kv dd { margin: 0; overflow-wrap: anywhere; }
.st-counts { display: flex; gap: calc(var(--stump-space) * 3); flex-wrap: wrap; margin: var(--stump-space) 0 calc(var(--stump-space) * 2); }
.st-counts strong { display: block; font-size: var(--stump-size-section); }
@media (max-width: 760px) {
  .st-table thead, .st-table .st-cell { display: none; }
  .st-table td { height: auto; padding: 12px 16px; }
  .st-rowline { display: block; font-size: var(--stump-size-small); color: var(--stump-muted); margin-top: 2px; }
  .st-columns { grid-template-columns: minmax(0, 1fr); }
  .st-columns > .st-aside { grid-column: auto; grid-row: auto; }
  .st-rule { grid-template-columns: 1fr; gap: 2px; }
  .st-kv { grid-template-columns: 1fr; }
  .st-toolbar .st-end { margin-left: 0; }
  .st-card { padding: calc(var(--stump-space) * 2); }
}
`
