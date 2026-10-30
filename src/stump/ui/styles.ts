// The signed-in app's look, all in tokens (final design SPEC §3). Screens use
// these st-* classes and --stump-* tokens and never their own colours. Every
// class and token name here is a public contract other screens build on:
// restyle values in place, add new names beside the old ones.
export const appStyles = `
:root {
  /* Colour (SPEC §3.1) */
  --stump-paper: #F9F3E4;
  --stump-paper-side: #F7F5EB;
  --stump-white: #FFFFFF;
  --stump-ink: #1C1B18;
  --stump-ink-hover: #2E2C28;
  --stump-body: #3B3933;
  --stump-hairline: #E6EAEE;
  --stump-paper-line: #E8E3D6;
  --stump-emerald: #0B8A60;
  --stump-emerald-text: #08724F;
  --stump-emerald-tint: #E7F0E8;
  --stump-focus-tint: #F1F7F3;
  --stump-danger-tint: #FDECEA;
  --stump-held: #8A4A1C;
  --stump-held-tint: #F6EADF;
  --stump-field-border: #D9DDE2;
  --stump-outline: #D9D5CB;
  /* The names every screen already uses, mapped onto the design */
  --stump-accent: var(--stump-ink);
  --stump-accent-text: var(--stump-white);
  --stump-canvas: var(--stump-paper-side);
  --stump-column: var(--stump-white);
  --stump-sunk: #F5F7F8;
  --stump-text: var(--stump-ink);
  --stump-muted: #66625A;
  --stump-line: var(--stump-hairline);
  --stump-field: var(--stump-field-border);
  --stump-focus: var(--stump-emerald);
  --stump-danger: #B42318;
  /* Shape and type (SPEC §3.2, §3.3) */
  --stump-radius: 14px;
  --stump-radius-field: 10px;
  --stump-radius-row: 12px;
  --stump-pill: 999px;
  --stump-font: Gantari, Arial, sans-serif;
  --stump-mono: ui-monospace, "SF Mono", Menlo, monospace;
  --stump-size-small: 14px;
  --stump-size-chip: 13px;
  --stump-size-body: 16px;
  --stump-size-section: 19px;
  --stump-size-title: 32px;
  --stump-space: 8px;
  --stump-shadow-menu: 0 12px 40px -12px rgba(28,27,24,.28);
  --stump-motion: 160ms ease-out;
}
body { margin: 0; padding: 0; background: var(--stump-column); color: var(--stump-text); font: var(--stump-size-body)/1.5 var(--stump-font); -webkit-font-smoothing: antialiased; }
*, *::before, *::after { box-sizing: border-box; }
a { color: var(--stump-emerald-text); }
code { font-family: var(--stump-mono); font-size: .9em; background: var(--stump-sunk); border-radius: 6px; padding: 1px 6px; }

/* Shell (SPEC §4.1): sidebar, top bar, white main column */
.st-shell { display: grid; grid-template-columns: 240px minmax(0, 1fr); min-height: 100vh; background: linear-gradient(to right, var(--stump-paper-side) 240px, var(--stump-column) 240px); }
.st-side { position: sticky; top: 0; height: 100vh; overflow-y: auto; background: var(--stump-paper-side); padding: 32px 16px 32px; display: flex; flex-direction: column; gap: 8px; }
.st-brand { display: inline-flex; align-items: center; gap: 10px; margin: 0 0 36px 24px; color: var(--stump-ink); text-decoration: none; font: 800 24px/1 var(--stump-font); letter-spacing: -0.02em; min-height: 40px; }
.st-brand img { width: 40px; height: 40px; display: block; }
.st-nav { display: flex; flex-direction: column; gap: 8px; }
.st-nav-label { font-size: var(--stump-size-chip); color: var(--stump-muted); padding: 0 24px; margin-bottom: 4px; }
.st-nav a { display: flex; align-items: center; gap: 18px; min-height: 52px; padding: 0 16px 0 24px; border-radius: var(--stump-radius-row); color: var(--stump-ink); text-decoration: none; font-size: 16px; font-weight: 500; transition: background-color var(--stump-motion); }
.st-nav a svg { flex: none; width: 22px; height: 22px; color: var(--stump-ink); }
.st-nav a:hover { background: rgba(28,27,24,.04); }
.st-nav a[aria-current="page"], .st-nav a.active { background: var(--stump-emerald-tint); font-weight: 600; }
.st-nav a[aria-current="page"] svg, .st-nav a.active svg { color: var(--stump-emerald); }
.st-nav-foot { margin-top: auto; padding-top: 24px; }
.st-who { margin-top: auto; font-size: var(--stump-size-small); color: var(--stump-muted); padding: 0 24px; }
.st-frame { display: flex; flex-direction: column; min-width: 0; min-height: 100vh; }
.st-topbar { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; justify-content: flex-end; gap: 24px; height: 72px; padding: 0 32px; background: var(--stump-white); border-bottom: 1px solid var(--stump-hairline); }
.st-topbar-brand, .st-topbar .st-menu-tip { display: none; }
.st-topbar-divider { width: 1px; height: 32px; background: var(--stump-hairline); }
.st-main { flex: 1; background: var(--stump-column); min-width: 0; padding: 40px 48px 64px; }
.st-page { max-width: 1120px; }
.st-page h1 { font-size: var(--stump-size-title); line-height: 38px; letter-spacing: -0.02em; margin: 0 0 8px; font-weight: 800; color: var(--stump-ink); }
.st-lead { color: var(--stump-muted); font-size: 16px; margin: 0 0 32px; max-width: 60ch; }
.st-page h2 { font-size: var(--stump-size-section); line-height: 26px; margin: 40px 0 12px; font-weight: 600; color: var(--stump-ink); }

/* The settings header the shell draws over every settings screen */
.st-settings-head { margin: 0 0 32px; }
.st-settings-title { font: 800 var(--stump-size-title)/38px var(--stump-font); letter-spacing: -0.02em; color: var(--stump-ink); margin: 0 0 20px; }
.st-tabs { display: flex; gap: 28px; border-bottom: 1px solid var(--stump-hairline); overflow-x: auto; scrollbar-width: none; }
.st-tabs a { display: inline-flex; align-items: center; min-height: 44px; padding: 0 2px; color: var(--stump-muted); text-decoration: none; font-size: 16px; font-weight: 500; white-space: nowrap; border-bottom: 2px solid transparent; margin-bottom: -1px; }
.st-tabs a:hover { color: var(--stump-ink); }
.st-tabs a[aria-current="page"] { color: var(--stump-ink); font-weight: 600; border-bottom-color: var(--stump-emerald); }
.st-settings .st-page > h1:first-child, .st-settings .st-page h1 { font-size: 24px; line-height: 30px; }

/* Lists and rows */
.st-list { list-style: none; margin: 0; padding: 0; }
.st-row { display: flex; align-items: center; gap: 16px; min-height: 56px; padding: 12px 0; border-top: 1px solid var(--stump-line); }
.st-row:first-child { border-top: 0; }
.st-row-main { flex: 1 1 240px; min-width: 0; }
.st-name { font-weight: 500; font-size: 16px; line-height: 22px; color: var(--stump-ink); overflow-wrap: anywhere; }
.st-meta { font-size: var(--stump-size-small); line-height: 20px; color: var(--stump-muted); overflow-wrap: anywhere; }
.st-actions { display: flex; gap: var(--stump-space); align-items: center; flex-wrap: wrap; }

/* Panels (SPEC §3.4: white, 1 px hairline, radius 14, no shadow) */
.st-panel { background: var(--stump-white); border: 1px solid var(--stump-hairline); border-radius: var(--stump-radius); padding: 24px; margin: 16px 0; }
.st-panel.focus { background: var(--stump-focus-tint); border-color: transparent; }
.st-panel.side { background: var(--stump-sunk); border-color: transparent; }
.st-panel-head { display: flex; align-items: center; gap: 16px; justify-content: space-between; flex-wrap: wrap; margin: 0 0 16px; }
.st-page .st-panel-title, .st-panel-title { display: flex; align-items: center; gap: 14px; margin: 0; font-size: var(--stump-size-section); line-height: 26px; font-weight: 600; color: var(--stump-ink); }
.st-page .st-panel-title { margin: 0; }
.st-panel > .st-panel-title:first-child { margin-bottom: 16px; }
.st-status { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; justify-content: space-between; background: var(--stump-focus-tint); border-radius: var(--stump-radius); padding: 24px; }
.st-status strong { font-size: var(--stump-size-section); font-weight: 600; }
.st-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--stump-emerald); margin-right: var(--stump-space); vertical-align: middle; }
.st-dot.paused { background: var(--stump-held); }
.st-dot.muted { background: #A9A59C; }

/* Banner: the one full-width notice at the top of the column (Paused) */
.st-banner { display: flex; align-items: center; gap: 16px; background: var(--stump-emerald-tint); border-radius: var(--stump-radius); padding: 16px 20px; margin: 0 0 32px; font-size: 18px; font-weight: 600; color: var(--stump-ink); }
.st-banner .st-disc { flex: none; }

/* Discs, ticks, initials */
.st-disc { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 36px; height: 36px; border-radius: 50%; background: var(--stump-emerald); color: var(--stump-white); }
.st-disc svg { width: 18px; height: 18px; }
.st-disc.big { width: 52px; height: 52px; background: var(--stump-emerald-tint); color: var(--stump-emerald-text); font: 800 20px/1 var(--stump-font); }
.st-tick { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 18px; height: 18px; border-radius: 50%; background: var(--stump-emerald); color: var(--stump-white); }
.st-tick svg { width: 12px; height: 12px; }
.st-initials { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 40px; height: 40px; border-radius: 50%; background: var(--stump-emerald-tint); color: var(--stump-ink); font: 600 15px/1 var(--stump-font); letter-spacing: .02em; }

/* Chips (26 px, SPEC §3.4) */
.st-chip { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border-radius: var(--stump-pill); background: var(--stump-sunk); color: var(--stump-muted); font-size: var(--stump-size-chip); line-height: 18px; font-weight: 500; white-space: nowrap; }
.st-chip.success { background: var(--stump-emerald-tint); color: var(--stump-emerald-text); }
.st-chip.held { background: var(--stump-held-tint); color: var(--stump-held); }
.st-chip.danger { background: var(--stump-danger-tint); color: var(--stump-danger); }
.st-chips { display: flex; flex-wrap: wrap; gap: 8px; }

/* Tables (SPEC §3.4: 13 px uppercase heads, 56 px rows, hairlines only) */
.st-table { width: 100%; border-collapse: collapse; }
.st-table th { text-align: left; font-size: var(--stump-size-chip); line-height: 18px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--stump-muted); padding: 0 16px 12px 0; border-bottom: 1px solid var(--stump-hairline); }
.st-table td { padding: 8px 16px 8px 0; height: 56px; border-bottom: 1px solid var(--stump-hairline); vertical-align: middle; font-size: 16px; }
.st-table tr:last-child td { border-bottom: 0; }
.st-cell-person { display: flex; align-items: center; gap: 14px; }

/* Forms (SPEC §3.4: 44 px fields, one 1 px border, focus on that border) */
.st-form { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); align-items: end; }
.st-field { display: flex; flex-direction: column; gap: 6px; font-size: var(--stump-size-small); font-weight: 500; color: var(--stump-ink); }
.st-field input, .st-field select, .st-field textarea, .st-select, .st-input { font: inherit; font-size: var(--stump-size-body); font-weight: 400; color: var(--stump-text); background: var(--stump-white); border: 1px solid var(--stump-field-border); border-radius: var(--stump-radius-field); padding: 0 12px; min-height: 44px; width: 100%; }
.st-field textarea { padding: 10px 12px; min-height: 96px; resize: vertical; }
.st-select { width: auto; }
.st-field input:focus-visible, .st-field select:focus-visible, .st-field textarea:focus-visible, .st-select:focus-visible, .st-input:focus-visible { outline: 2px solid var(--stump-emerald); outline-offset: 2px; }
.st-button:focus-visible, .st-nav a:focus-visible, .st-tabs a:focus-visible, .st-icon-button:focus-visible, .st-pause:focus-visible, .st-avatar:focus-visible, .st-menu a:focus-visible, .st-menu button:focus-visible, .st-brand:focus-visible { outline: 2px solid var(--stump-emerald); outline-offset: 2px; }

/* Buttons: every button is a pill (SPEC §3.4) */
.st-button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; font: inherit; font-size: 15px; line-height: 20px; font-weight: 600; border: 1px solid var(--stump-hairline); border-radius: var(--stump-pill); padding: 0 20px; min-height: 44px; cursor: pointer; background: var(--stump-white); color: var(--stump-ink); text-decoration: none; white-space: nowrap; transition: background-color var(--stump-motion), transform var(--stump-motion); }
.st-button svg { width: 18px; height: 18px; }
.st-button:hover { background: var(--stump-sunk); }
.st-button.primary { background: var(--stump-ink); border-color: var(--stump-ink); color: var(--stump-white); }
.st-button.primary:hover { background: var(--stump-ink-hover); transform: translateY(-1px); }
.st-button.quiet { background: var(--stump-emerald-tint); border-color: transparent; color: var(--stump-ink); }
.st-button.quiet:hover { background: #DCE9DE; }
.st-button.small { min-height: 36px; padding: 0 14px; font-size: 14px; }
.st-button.large { min-height: 56px; padding: 0 28px; font-size: 17px; }
.st-button.danger { color: var(--stump-danger); background: transparent; border-color: transparent; }
.st-button.danger:hover { background: var(--stump-danger-tint); }
.st-button:disabled { opacity: .55; cursor: default; transform: none; }
.st-note, .st-error { margin: 4px 0 0; }
.st-note:empty, .st-error:empty { margin: 0; }
.st-note { font-size: var(--stump-size-small); color: var(--stump-muted); }
.st-error { color: var(--stump-danger); font-size: var(--stump-size-small); }
.st-secret { font-family: var(--stump-mono); font-size: var(--stump-size-small); background: var(--stump-sunk); border-radius: var(--stump-radius-field); padding: 12px; overflow-wrap: anywhere; user-select: all; }

/* Top bar controls: the Pause pill, the avatar and its menu */
.st-pause { display: inline-flex; align-items: center; gap: 10px; min-height: 40px; padding: 0 16px 0 6px; border: 0; border-radius: var(--stump-pill); background: var(--stump-emerald-tint); color: var(--stump-ink); font: 500 15px/20px var(--stump-font); cursor: pointer; white-space: nowrap; transition: background-color var(--stump-motion); }
.st-pause .st-pause-icon { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%; background: var(--stump-white); color: var(--stump-ink); }
.st-pause .st-pause-icon svg { width: 14px; height: 14px; }
.st-pause:hover { background: #DCE9DE; }
.st-pause.paused { background: var(--stump-ink); color: var(--stump-white); }
.st-pause.paused .st-pause-icon { background: var(--stump-emerald); color: var(--stump-white); }
.st-pause.paused:hover { background: var(--stump-ink-hover); }
.st-pop-anchor { position: relative; display: inline-flex; }
.st-avatar { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border: 0; border-radius: 50%; background: var(--stump-emerald-tint); color: var(--stump-ink); font: 600 15px/1 var(--stump-font); cursor: pointer; padding: 0; }
.st-menu { position: absolute; right: 0; top: calc(100% + 8px); z-index: 40; min-width: 220px; background: var(--stump-white); border: 1px solid var(--stump-hairline); border-radius: var(--stump-radius); box-shadow: var(--stump-shadow-menu); padding: 8px; }
.st-menu-name { padding: 8px 12px 10px; border-bottom: 1px solid var(--stump-hairline); margin-bottom: 6px; }
.st-menu a, .st-menu button { display: flex; align-items: center; width: 100%; min-height: 44px; padding: 0 12px; border: 0; border-radius: 10px; background: transparent; color: var(--stump-ink); font: 500 15px/20px var(--stump-font); text-decoration: none; text-align: left; cursor: pointer; }
.st-menu a:hover, .st-menu button:hover { background: var(--stump-sunk); }
.st-popover { position: absolute; right: 0; top: calc(100% + 10px); z-index: 40; width: 360px; background: var(--stump-white); border: 1px solid var(--stump-hairline); border-radius: var(--stump-radius); box-shadow: var(--stump-shadow-menu); padding: 20px 24px 24px; }
.st-popover h2, .st-popover .st-popover-title { margin: 0 0 12px; font-size: var(--stump-size-section); line-height: 26px; font-weight: 600; color: var(--stump-ink); }
.st-popover .st-actions, .st-popover > .st-note { margin-top: 16px; }
.st-banner-text { flex: 1; min-width: 0; }
.st-chip svg { width: 14px; height: 14px; }
.st-count-row { display: flex; align-items: flex-start; gap: 12px; padding: 12px 0; border-top: 1px solid var(--stump-hairline); }
.st-count-row:first-of-type { border-top: 0; }
.st-count { display: inline-flex; align-items: center; justify-content: center; flex: none; min-width: 28px; height: 28px; padding: 0 6px; border-radius: var(--stump-pill); background: var(--stump-emerald-tint); color: var(--stump-emerald-text); font: 700 14px/1 var(--stump-font); }
.st-count.held { background: var(--stump-held-tint); color: var(--stump-held); }
.st-scrim { display: none; }
.st-icon-button { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; border: 0; border-radius: 50%; background: transparent; color: var(--stump-ink); cursor: pointer; padding: 0; }
.st-icon-button svg { width: 22px; height: 22px; }
.st-icon-button:hover { background: var(--stump-sunk); }

/* Segmented control (Mine | Everyone) */
.st-segmented { display: inline-flex; gap: 4px; padding: 4px; background: var(--stump-sunk); border-radius: var(--stump-pill); }
.st-segmented button { min-height: 36px; padding: 0 16px; border: 0; border-radius: var(--stump-pill); background: transparent; color: var(--stump-muted); font: 500 15px/20px var(--stump-font); cursor: pointer; }
.st-segmented button[aria-pressed="true"] { background: var(--stump-emerald-tint); color: var(--stump-ink); font-weight: 600; }

/* Empty states: the one place everyday screens carry the pastel stump */
.st-empty { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 48px 16px; }
.st-empty img { width: 240px; max-width: 70%; height: auto; margin-bottom: 16px; }
.st-empty h2 { font-size: 24px; line-height: 30px; font-weight: 800; margin: 0 0 8px; }
.st-empty p { color: var(--stump-muted); margin: 0 0 24px; max-width: 46ch; }

/* The one tooltip (H19): 2-4 words, ~300 ms on hover, at once on focus */
.st-tip { position: relative; display: inline-flex; }
.st-tip [role="tooltip"] { position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%); white-space: nowrap; background: var(--stump-ink); color: var(--stump-white); font-size: 13px; line-height: 18px; padding: 4px 8px; border-radius: 6px; pointer-events: none; opacity: 0; transition: opacity .1s; z-index: 50; }
.st-tip.below [role="tooltip"] { bottom: auto; top: calc(100% + 6px); }
.st-tip:hover [role="tooltip"] { opacity: 1; transition-delay: .3s; }
.st-tip:focus-within [role="tooltip"] { opacity: 1; transition-delay: 0s; }
.st-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

@media (prefers-reduced-motion: reduce) { .st-button, .st-nav a, .st-pause { transition: none; } .st-button.primary:hover { transform: none; } }

/* 390 (SPEC §4.1): a 56 px top bar, the sidebar as a drawer, 16 px gutters */
@media (max-width: 900px) {
  .st-shell { grid-template-columns: minmax(0, 1fr); background: var(--stump-column); }
  .st-side { position: fixed; inset: 0 auto 0 0; z-index: 60; width: min(300px, 86vw); height: 100%; padding: 20px 12px 24px; transform: translateX(-100%); visibility: hidden; transition: transform var(--stump-motion), visibility 0s linear .16s; box-shadow: var(--stump-shadow-menu); }
  .st-shell.drawer-open .st-side { transform: none; visibility: visible; transition: transform var(--stump-motion); }
  .st-shell.drawer-open .st-scrim { display: block; position: fixed; inset: 0; z-index: 55; background: rgba(28,27,24,.32); border: 0; }
  .st-brand { margin: 4px 0 24px 16px; }
  .st-nav a { padding-left: 16px; }
  .st-topbar { height: 56px; padding: 0 12px 0 4px; gap: 8px; justify-content: flex-start; }
  .st-topbar .st-menu-tip { display: inline-flex; }
  .st-topbar-brand { display: inline-flex; align-items: center; gap: 8px; margin-right: auto; color: var(--stump-ink); text-decoration: none; font: 800 20px/1 var(--stump-font); letter-spacing: -0.02em; min-height: 44px; }
  .st-topbar-brand img { width: 28px; height: 28px; }
  .st-topbar-divider { display: none; }
  .st-pause { min-height: 44px; }
  .st-pause:not(.paused) { width: 44px; padding: 0; justify-content: center; }
  .st-pause:not(.paused) .st-pause-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .st-pause:not(.paused) .st-pause-icon { background: transparent; }
  .st-pause:not(.paused) .st-pause-icon svg { width: 18px; height: 18px; }
  .st-pause.paused { padding: 0 14px 0 6px; }
  .st-avatar { width: 44px; height: 44px; padding: 4px; background-clip: content-box; font-size: 14px; }
  .st-main { padding: 24px 16px 48px; }
  .st-page h1, .st-settings-title { font-size: 26px; line-height: 32px; }
  .st-settings .st-page h1 { font-size: 22px; line-height: 28px; }
  .st-settings-title { margin-bottom: 12px; }
  .st-tabs { gap: 20px; margin: 0 -16px; padding: 0 16px; }
  .st-row { flex-wrap: wrap; }
  .st-panel { padding: 16px; }
  .st-popover { position: fixed; inset: auto 0 0 0; top: auto; width: auto; border-radius: 20px 20px 0 0; padding: 20px 16px calc(24px + env(safe-area-inset-bottom)); }
  .st-banner { font-size: 16px; padding: 12px 14px; margin-bottom: 24px; }
  .st-table, .st-table tbody, .st-table tr, .st-table td { display: block; width: 100%; }
  .st-table thead { display: none; }
  .st-table tr { padding: 12px 0; border-bottom: 1px solid var(--stump-hairline); }
  .st-table tr:last-child { border-bottom: 0; }
  .st-table td { height: auto; padding: 0; border: 0; }
  .st-table td:not(:first-child) { display: inline-flex; align-items: center; width: auto; margin: 8px 14px 0 0; vertical-align: middle; }
  .st-table tr:has(.st-cell-person) td:nth-child(2) { margin-left: 54px; }
  .st-button { min-height: 44px; }
  .st-button.small { min-height: 44px; }
  .st-segmented button { min-height: 44px; }
}
`
