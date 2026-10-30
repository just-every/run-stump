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
.st-tabs a { flex: none; display: inline-flex; align-items: center; justify-content: center; min-height: 44px; min-width: 44px; padding: 0 2px; color: var(--stump-muted); text-decoration: none; font-size: 16px; font-weight: 500; white-space: nowrap; border-bottom: 2px solid transparent; margin-bottom: -1px; }
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
/* The one disabled ink pill (SPEC §3.4): a --line fill with --muted text, never a mid-grey ink. */
.st-button.primary:disabled, .st-button.primary:disabled:hover, .st-button.ink:disabled, .st-drafting .st-button.ink:disabled, .st-drafting .st-button.ink:disabled:hover { opacity: 1; background: var(--stump-line); border-color: var(--stump-line); color: var(--stump-muted); transform: none; }
/* Save as you go (L15): a quiet "✓ Saved" beside what saved */
.st-saved-mark { display: inline-flex; align-items: center; gap: 4px; min-height: 20px; font-size: var(--stump-size-small); color: var(--stump-emerald-text); font-weight: 500; }
.st-saved-mark:empty { min-height: 0; }
/* A row's "⋯" More actions menu (kit MoreMenu) */
.st-more-menu { position: relative; display: inline-flex; flex: none; }
.st-more-menu .st-menu { top: calc(100% + 4px); min-width: 200px; }
.st-menu button.danger { color: var(--stump-danger); }

/* Accounts, publishing and connected accounts: boxed lists and expanding rows (src/routes/app.settings.accounts.tsx, app.settings.publishing.tsx) */
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
/* Settings · Import: the confirmation is a checkbox beside its words, at every width. */
.st-buffer .st-field.st-check input { width: auto; flex: none; }
.st-days { display: flex; flex-wrap: wrap; gap: 4px; }
.st-days label { display: inline-flex; align-items: center; gap: 4px; font-size: var(--stump-size-small); color: var(--stump-text); min-height: 32px; padding: 0 8px; background: var(--stump-sunk); border-radius: 8px; }
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
.st-resume-wait { min-height: 104px; }
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
/* A hidden tooltip is out of layout, so one near an edge never widens the page. */
.st-tip [role="tooltip"] { display: none; position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%); white-space: nowrap; background: var(--stump-ink); color: var(--stump-white); font-size: 13px; line-height: 18px; padding: 4px 8px; border-radius: 6px; pointer-events: none; z-index: 50; }
.st-tip.below [role="tooltip"] { bottom: auto; top: calc(100% + 6px); }
.st-tip.end [role="tooltip"] { left: auto; right: 0; transform: none; }
.st-tip:hover [role="tooltip"] { display: block; animation: st-tip-in .1s ease-out .3s both; }
.st-tip:focus-within [role="tooltip"] { display: block; animation: st-tip-in .1s ease-out both; }
@keyframes st-tip-in { from { opacity: 0; } to { opacity: 1; } }
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
  .st-pause.paused .st-pause-more { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .st-topbar .st-tip:not(.st-menu-tip) [role="tooltip"] { left: auto; right: 0; transform: none; }
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

/* Venues: toolbar, table, chips, cards and the two-column detail (src/routes/app.venues.*). */
:root {
  --stump-accent-tint: var(--stump-emerald-tint);
  --stump-accent-ink: var(--stump-emerald-text);
  --stump-radius-card: var(--stump-radius);
}
.st-sub { color: var(--stump-muted); margin: 0 0 calc(var(--stump-space) * 4); }
.st-toolbar { display: flex; gap: calc(var(--stump-space) * 1.5); align-items: center; flex-wrap: wrap; margin-bottom: calc(var(--stump-space) * 2); }
.st-toolbar .st-grow { flex: 1 1 260px; max-width: 480px; }
.st-search { font: inherit; font-size: var(--stump-size-body); width: 100%; box-sizing: border-box; min-height: 44px; padding: 8px 14px; border: 1px solid var(--stump-field); border-radius: 10px; background: var(--stump-column); color: var(--stump-text); }
.st-search:focus { outline: 2px solid var(--stump-focus); outline-offset: 1px; }
.st-toolbar .st-end { margin-left: auto; }
.st-button.pill { border-radius: 999px; }
.st-button.outline { background: var(--stump-column); border: 1px solid var(--stump-line); }
.st-chip.ok { background: var(--stump-emerald-tint); color: var(--stump-emerald-text); }
button.st-chip { cursor: pointer; border: 0; font-family: inherit; }
.st-chips.st-applied { margin-bottom: calc(var(--stump-space) * 2); }
.st-chip .st-dot { width: 8px; height: 8px; margin: 0; }
.st-dot.open { background: transparent; box-shadow: inset 0 0 0 1.5px currentColor; }
.st-table.st-linked tbody tr { cursor: pointer; }
.st-table.st-linked tbody tr:hover td { background: var(--stump-sunk); }
.st-table.st-linked a { color: inherit; text-decoration: none; font-weight: 560; }
.st-table.st-linked a:focus-visible { outline: 2px solid var(--stump-focus); outline-offset: 2px; }
.st-rowline { display: none; }
.st-card { background: var(--stump-column); border: 1px solid var(--stump-line); border-radius: var(--stump-radius-card); padding: calc(var(--stump-space) * 3); margin-bottom: calc(var(--stump-space) * 2); min-width: 0; }
.st-card h2 { margin: 0 0 calc(var(--stump-space) * 1.5); }
.st-columns { display: grid; grid-template-columns: minmax(0, 1fr) 360px; column-gap: calc(var(--stump-space) * 3); align-items: start; }
.st-columns > .st-aside { grid-column: 2; grid-row: 1 / span 2; }
.st-back { display: inline-block; color: var(--stump-muted); text-decoration: none; margin-bottom: calc(var(--stump-space) * 2); }
.st-back:hover { color: var(--stump-text); }
.st-rule { display: grid; grid-template-columns: 150px minmax(0, 1fr) auto; gap: calc(var(--stump-space) * 2); align-items: center; padding: 14px 0; border-top: 1px solid var(--stump-line); }
.st-rule:first-of-type { border-top: 0; }
.st-rule-label { font-weight: 600; }
.st-rule-value { display: inline-flex; align-items: center; gap: 6px; min-width: 0; overflow-wrap: anywhere; }
.st-rule-thread { display: inline-flex; align-items: center; justify-content: center; min-width: 28px; min-height: 32px; color: var(--stump-emerald-text); text-decoration: none; font-weight: 600; border-radius: 6px; }
.st-rule-thread:focus-visible { outline: 2px solid var(--stump-focus); outline-offset: 2px; }
.st-rule-source { font-size: var(--stump-size-small); color: var(--stump-muted); white-space: nowrap; }
.st-rule-source a { color: var(--stump-accent-ink); }
.st-value { font: inherit; text-align: left; background: none; border: 0; padding: 4px 0; color: var(--stump-text); cursor: pointer; min-height: 32px; }
.st-value:hover { text-decoration: underline; }
.st-value:focus-visible { outline: 2px solid var(--stump-focus); outline-offset: 2px; }
.st-empty .st-actions { justify-content: center; }
.st-kv { display: grid; grid-template-columns: 140px minmax(0, 1fr); gap: 6px calc(var(--stump-space) * 2); margin: 0; }
.st-kv dt { color: var(--stump-muted); }
.st-kv dd { margin: 0; overflow-wrap: anywhere; }
.st-counts { display: flex; gap: calc(var(--stump-space) * 3); flex-wrap: wrap; margin: var(--stump-space) 0 calc(var(--stump-space) * 2); }
.st-counts strong { display: block; font-size: var(--stump-size-section); }
@media (max-width: 760px) {
  .st-table th.st-cell, .st-table td.st-cell { display: none; }
  .st-rowline { display: block; font-size: var(--stump-size-small); color: var(--stump-muted); margin-top: 2px; }
  .st-columns { grid-template-columns: minmax(0, 1fr); }
  .st-columns > .st-aside { grid-column: auto; grid-row: auto; }
  .st-rule { grid-template-columns: 1fr; gap: 2px; }
  .st-kv { grid-template-columns: 1fr; }
  .st-toolbar .st-end { margin-left: 0; }
  .st-card { padding: calc(var(--stump-space) * 2); }
}

/* Accounts and publishing at phone width: an expanding row's state under its name */
@media (max-width: 760px) {
  .st-row-toggle { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px var(--stump-space); }
  .st-row-toggle .st-state { grid-column: 1; grid-row: 2; }
  .st-row-toggle .st-chevron { grid-column: 2; grid-row: 1 / span 2; align-self: center; }
}

/* Drafting: Compose and Settings · Brand (src/routes/app.compose.tsx, app.settings.brand.tsx).
   Every rule is scoped to the drafting screens' .st-drafting, so the shared st-* classes keep their values elsewhere. */
.st-drafting .st-card { margin: 0 0 calc(var(--stump-space) * 3); }
.st-drafting .st-card-head { display: flex; align-items: center; gap: 12px; margin: 0 0 calc(var(--stump-space) * 2); font-size: var(--stump-size-section); line-height: 26px; font-weight: 600; }
.st-drafting .st-sub { display: flex; align-items: center; gap: 10px; color: var(--stump-ink); font-size: var(--stump-size-body); font-weight: 600; margin: calc(var(--stump-space) * 3) 0 calc(var(--stump-space) * 1.5); }
.st-drafting .st-sub .st-disc, .st-drafting .st-check-list .st-disc { width: 24px; height: 24px; }
.st-drafting .st-sub .st-disc svg, .st-drafting .st-check-list .st-disc svg { width: 14px; height: 14px; }
.st-drafting .st-disc.danger { background: var(--stump-danger); }
.st-drafting .st-textarea { font: inherit; font-size: var(--stump-size-body); color: var(--stump-text); background: var(--stump-white); width: 100%; border: 1px solid var(--stump-field-border); border-radius: var(--stump-radius-field); padding: 12px 14px; resize: vertical; }
.st-drafting .st-textarea.large { font-size: 20px; line-height: 1.45; min-height: 128px; field-sizing: content; }
.st-drafting .st-textarea:focus-visible, .st-drafting .st-inline input:focus-visible, .st-drafting .st-when input:focus-visible, .st-drafting button.st-chip:focus-visible, .st-drafting .st-icon:focus-visible, .st-drafting .st-variant-head:focus-visible, .st-drafting .st-checks-toggle:focus-visible { outline: 2px solid var(--stump-emerald); outline-offset: 2px; }
.st-drafting .st-chars { font-size: var(--stump-size-small); color: var(--stump-muted); text-align: right; margin-left: auto; white-space: nowrap; }
.st-drafting .st-chars.over { color: var(--stump-danger); font-weight: 600; }
.st-drafting .st-source { display: flex; align-items: flex-end; gap: var(--stump-space); margin-top: calc(var(--stump-space) * 2); max-width: 520px; }
.st-drafting .st-source .st-field { flex: 1; }
.st-drafting .st-icon { font: inherit; font-size: 20px; line-height: 1; width: 44px; height: 44px; border: 0; border-radius: 50%; background: var(--stump-sunk); color: var(--stump-text); cursor: pointer; }
.st-drafting button.st-chip { height: 36px; padding: 0 14px; font-size: var(--stump-size-small); color: var(--stump-ink); }
.st-drafting .st-chip[aria-pressed="true"] { background: var(--stump-emerald-tint); font-weight: 600; }
.st-drafting .st-chip:disabled { cursor: default; }
.st-drafting .st-open { margin-top: calc(var(--stump-space) * 3); }
.st-drafting .st-compose { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: calc(var(--stump-space) * 3); align-items: start; }
.st-drafting .st-compose > * { min-width: 0; }
.st-drafting .st-compose { margin-bottom: calc(var(--stump-space) * 3); }
.st-drafting .st-compose > .st-card { margin-bottom: 0; }
.st-drafting .st-source-chip { display: inline-flex; align-items: center; gap: 12px; margin-top: calc(var(--stump-space) * 2); padding: 10px 18px 10px 12px; border-radius: var(--stump-pill); background: var(--stump-emerald-tint); overflow-wrap: anywhere; }
.st-drafting .st-source-chip .st-disc { width: 28px; height: 28px; }
.st-drafting .st-variants { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: calc(var(--stump-space) * 2); }
.st-drafting .st-variant { border: 1px solid var(--stump-hairline); border-radius: var(--stump-radius); padding: calc(var(--stump-space) * 2); background: var(--stump-white); min-width: 0; }
.st-drafting .st-variant:focus-within { border-color: var(--stump-emerald); }
.st-drafting .st-variant.flagged { border-color: var(--stump-danger); }
.st-drafting .st-variant.flagged .st-variant-head strong { color: var(--stump-danger); }
.st-drafting .st-variant-head { font: inherit; display: flex; align-items: center; gap: var(--stump-space); width: 100%; background: none; border: 0; padding: 0 0 var(--stump-space); color: var(--stump-text); cursor: default; text-align: left; }
.st-drafting .st-variant textarea { font: inherit; font-size: var(--stump-size-body); color: var(--stump-text); width: 100%; border: 0; padding: 0; background: transparent; resize: none; field-sizing: content; min-height: 96px; outline: none; }
.st-drafting .st-flag-list { list-style: none; margin: var(--stump-space) 0 0; padding: 0; color: var(--stump-danger); font-size: var(--stump-size-small); }
.st-drafting .st-pill { display: inline-flex; align-items: center; font-size: var(--stump-size-small); border-radius: var(--stump-pill); padding: 3px 10px; margin: 0 8px 0 0; background: var(--stump-emerald-tint); color: var(--stump-emerald-text); text-decoration: none; white-space: nowrap; }
.st-drafting .st-pill.danger { background: var(--stump-danger-tint); color: var(--stump-danger); }
.st-drafting .st-pill.quiet { padding: 9px 16px; }
.st-drafting .st-check-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
.st-drafting .st-check-list li { display: flex; gap: 10px; align-items: flex-start; font-size: var(--stump-size-small); }
.st-drafting .st-check-list li.danger span:last-child { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
.st-drafting .st-checks-toggle { display: none; }
.st-drafting .st-bar { display: flex; align-items: center; gap: calc(var(--stump-space) * 2); flex-wrap: wrap; padding-top: calc(var(--stump-space) * 3); border-top: 1px solid var(--stump-hairline); }
.st-drafting .st-button.ink { background: var(--stump-ink); border-color: var(--stump-ink); color: var(--stump-white); padding: 0 24px; }
.st-drafting .st-button.ink:hover { background: var(--stump-ink-hover); }
/* The schedule time: a pill that opens a day and time picker above the bar */
.st-drafting .st-when { position: relative; }
.st-drafting .st-when-pill { display: inline-flex; align-items: center; gap: 10px; font: 500 15px/20px var(--stump-font); color: var(--stump-ink); background: var(--stump-white); border: 1px solid var(--stump-hairline); border-radius: var(--stump-pill); padding: 0 16px; min-height: 44px; cursor: pointer; white-space: nowrap; }
.st-drafting .st-when-pill:hover { background: var(--stump-sunk); }
.st-drafting .st-when-pill svg { width: 18px; height: 18px; flex: none; }
.st-drafting .st-when-pill { max-width: 100%; }
.st-drafting .st-when-pill span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.st-drafting .st-when-pill:focus-visible { outline: 2px solid var(--stump-emerald); outline-offset: 2px; }
.st-drafting .st-when-pop { position: absolute; left: 0; bottom: calc(100% + 8px); z-index: 30; display: grid; gap: 12px; width: 280px; padding: 16px; background: var(--stump-white); border: 1px solid var(--stump-hairline); border-radius: var(--stump-radius); box-shadow: var(--stump-shadow-menu); }
.st-drafting .st-pill.held { background: var(--stump-held-tint); color: var(--stump-held); padding: 9px 16px; }
/* A variant's field: its text drawn underneath, so links read in emerald text and the part past the limit sits on the danger tint */
.st-drafting .st-variant-field { display: grid; }
.st-drafting .st-variant-field > * { grid-area: 1 / 1; font: inherit; font-size: var(--stump-size-body); line-height: 1.5; letter-spacing: normal; margin: 0; padding: 0; border: 0; white-space: pre-wrap; overflow-wrap: break-word; word-break: normal; min-width: 0; }
.st-drafting .st-variant-marks { color: var(--stump-body); pointer-events: none; }
.st-drafting .st-variant-marks .st-link { color: var(--stump-emerald-text); }
.st-drafting .st-variant-marks mark { background: var(--stump-danger-tint); color: var(--stump-danger); border-radius: 3px; }
.st-drafting .st-variant-field textarea { color: transparent; caret-color: var(--stump-ink); background: transparent; overflow: hidden; }
.st-drafting .st-variant-field textarea::selection { background: rgba(11,138,96,.22); }
.st-drafting .st-kv { grid-template-columns: minmax(160px, 260px) minmax(0, 1fr); gap: calc(var(--stump-space) * 2); padding: 14px 0; border-top: 1px solid var(--stump-hairline); align-items: center; }
.st-drafting .st-kv:first-child { border-top: 0; }
.st-drafting .st-inline { display: flex; align-items: center; gap: var(--stump-space); color: var(--stump-muted); }
.st-drafting .st-inline input { font: inherit; color: var(--stump-text); flex: 1; min-width: 0; border: 1px solid transparent; border-radius: 8px; padding: 6px 8px; background: transparent; }
.st-drafting .st-inline input:hover { border-color: var(--stump-hairline); }
.st-drafting .st-adder { margin-top: calc(var(--stump-space) * 2); padding-top: calc(var(--stump-space) * 2); border-top: 1px solid var(--stump-hairline); }
.st-drafting .st-add { margin-top: calc(var(--stump-space) * 2); }
.st-drafting .st-span { grid-column: 1 / -1; }
.st-drafting .st-saved { display: flex; justify-content: flex-end; align-items: center; gap: 12px; position: sticky; bottom: 16px; pointer-events: none; }
.st-drafting .st-saved > * { pointer-events: auto; }
.st-drafting .st-saved .st-saved-mark:not(:empty) { background: var(--stump-white); border-radius: var(--stump-pill); padding: 4px 12px; }
.st-drafting .st-profile .st-inline.st-inline-add { display: block; }
.st-drafting .st-add-words { font: inherit; font-size: var(--stump-size-body); color: var(--stump-emerald-text); font-weight: 500; background: none; border: 0; padding: 6px 0; min-height: 32px; cursor: pointer; text-align: left; }
.st-drafting .st-add-words:hover { text-decoration: underline; text-underline-offset: 3px; }
.st-drafting .st-add-words:focus-visible { outline: 2px solid var(--stump-emerald); outline-offset: 2px; border-radius: 6px; }
.st-drafting .st-master { position: relative; }
.st-drafting .st-master .st-textarea.large { padding-bottom: 36px; display: block; }
.st-drafting .st-master .st-chars { position: absolute; right: 14px; bottom: 10px; }
.st-drafting .st-check-list li.st-check-detail { padding-left: 34px; color: var(--stump-muted); }
.st-drafting .st-kv > :last-child { border-left: 1px solid var(--stump-hairline); padding-left: calc(var(--stump-space) * 3); min-height: 28px; }
.st-drafting .st-profile { display: grid; gap: 2px; }
.st-drafting .st-profile .st-inline { display: grid; grid-template-columns: 56px minmax(0, 1fr); }
.st-drafting .st-profile .st-inline input { padding: 2px 8px; min-height: 32px; }
@media (max-width: 760px) {
  .st-drafting .st-compose { grid-template-columns: 1fr; }
  .st-drafting .st-checks-toggle { display: flex; align-items: center; gap: 10px; font: inherit; width: 100%; background: none; border: 0; padding: 0; color: var(--stump-text); text-align: left; min-height: 44px; }
  .st-drafting .st-checks:not(.open) .st-card-head, .st-drafting .st-checks:not(.open) .st-check-list { display: none; }
  .st-drafting .st-checks.open .st-card-head { margin-top: calc(var(--stump-space) * 2); }
  .st-drafting .st-variants { grid-template-columns: 1fr; }
  .st-drafting .st-variant-head { cursor: pointer; min-height: 44px; padding: 0; }
  .st-drafting .st-variant-body:not(.open) { display: none; }
  .st-drafting .st-bar { position: sticky; bottom: 0; z-index: 2; background: var(--stump-white); padding: 12px 0; gap: var(--stump-space); flex-wrap: nowrap; }
  .st-drafting .st-bar .st-button.ink { padding: 0 16px; flex: none; }
  .st-drafting .st-bar .st-when { flex: 1; min-width: 0; }
  .st-drafting .st-when-pill { width: 100%; padding: 0 12px; font-size: 14px; gap: 6px; justify-content: center; }
  .st-drafting .st-when-pop { left: auto; right: 0; width: min(280px, calc(100vw - 32px)); }
  .st-drafting .st-bar > :nth-child(n+3) { display: none; }
  .st-drafting .st-kv { grid-template-columns: 1fr; gap: 4px; }
  .st-drafting .st-kv > :last-child { border-left: 0; padding-left: 0; min-height: 0; }
  .st-drafting .st-textarea.large { font-size: 18px; }
}

/* First-run setup (src/routes/app.setup.tsx, SPEC §4.2): the paper page, the stump seated above one white card, four numbered steps. */
.st-setup { min-height: 100vh; background: var(--stump-paper) url('/art/grain.png') repeat; padding: 32px 24px 64px; display: flex; flex-direction: column; align-items: center; }
.st-setup-brand { align-self: flex-start; display: inline-flex; align-items: center; gap: 10px; color: var(--stump-ink); text-decoration: none; font: 800 28px/1 var(--stump-font); letter-spacing: -0.02em; margin: 0 0 8px 56px; min-height: 44px; }
.st-setup-brand img { width: 40px; height: 40px; }
.st-setup-plate { display: block; width: 240px; height: auto; margin: 0 0 12px; }
.st-setup h1 { margin: 0 0 32px; font: 800 64px/1 var(--stump-font); letter-spacing: -0.03em; color: var(--stump-ink); text-align: center; }
.st-setup-card { width: 100%; max-width: 936px; background: var(--stump-white); border-radius: 18px; box-shadow: 0 1px 2px rgba(28,27,24,.05), 0 14px 32px -14px rgba(92,70,30,.22); padding: 40px 40px 36px; }
.st-setup-steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; }
.st-setup-steps > li { display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 0 32px; align-items: start; padding: 0 0 32px; }
.st-setup-steps > li:nth-child(odd) { padding-right: 40px; box-shadow: inset -1px 0 0 var(--stump-hairline); }
.st-setup-steps > li:nth-child(even) { padding-left: 40px; }
.st-setup-steps > li:nth-child(n+3) { padding-top: 32px; background: linear-gradient(var(--stump-hairline), var(--stump-hairline)) top / 100% 1px no-repeat; }
.st-setup-num { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 50%; background: var(--stump-emerald); color: var(--stump-white); font: 700 20px/1 var(--stump-font); }
.st-setup-steps h2 { margin: 6px 0 10px; font: 700 22px/28px var(--stump-font); color: var(--stump-ink); }
.st-setup-value { display: block; width: 100%; font: 400 19px/26px var(--stump-font); color: var(--stump-body); background: transparent; border: 1px solid transparent; border-radius: var(--stump-radius-field); padding: 6px 10px; margin-left: -11px; min-height: 40px; }
.st-setup-value:hover { border-color: var(--stump-hairline); }
.st-setup-value:focus-visible, .st-setup-site input:focus-visible, .st-setup-pill:focus-visible, .st-setup-brand:focus-visible { outline: 2px solid var(--stump-emerald); outline-offset: 2px; }
.st-setup-site { display: block; margin-top: 8px; }
.st-setup-site input { width: 100%; font: 400 15px/20px var(--stump-font); color: var(--stump-ink); background: var(--stump-sunk); border: 1px solid transparent; border-radius: var(--stump-pill); padding: 0 14px; min-height: 40px; }
.st-setup-pills { display: flex; flex-wrap: wrap; gap: 12px; }
.st-setup-pill { display: inline-flex; align-items: center; min-height: 40px; padding: 0 16px; border-radius: var(--stump-pill); background: var(--stump-emerald-tint); color: var(--stump-ink); font: 500 15px/20px var(--stump-font); text-decoration: none; white-space: nowrap; }
.st-setup-pill:hover { background: #DCE9DE; }
.st-setup-done { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; color: var(--stump-body); font-size: 15px; }
.st-setup-foot { display: flex; flex-direction: column; align-items: center; gap: 8px; padding-top: 8px; }
.st-setup-foot .st-button.large { min-width: 224px; }
@media (max-width: 760px) {
  .st-setup { padding: 16px 16px 40px; }
  .st-setup-brand { margin: 0 0 8px; font-size: 22px; }
  .st-setup-brand img { width: 32px; height: 32px; }
  .st-setup-plate { width: 180px; }
  .st-setup h1 { font-size: 40px; margin-bottom: 24px; }
  .st-setup-card { padding: 24px 20px; }
  .st-setup-steps { grid-template-columns: 1fr; }
  .st-setup-steps > li, .st-setup-steps > li:nth-child(odd), .st-setup-steps > li:nth-child(even) { padding: 20px 0; box-shadow: none; gap: 0 16px; }
  .st-setup-steps > li:first-child { padding-top: 0; }
  .st-setup-steps > li:nth-child(n+2) { background: linear-gradient(var(--stump-hairline), var(--stump-hairline)) top / 100% 1px no-repeat; }
  .st-setup-steps h2 { font-size: 20px; margin-top: 7px; }
  .st-setup-foot .st-button.large { width: 100%; }
  .st-setup-pill { white-space: normal; padding: 10px 16px; }
}

/* Venues with none yet (SPEC §4.2 "Empty state, Venues"): the plate and its block centred in the column */
.st-venues-empty { min-height: calc(100vh - 72px - 40px - 46px - 64px); display: flex; flex-direction: column; justify-content: center; }
.st-venues-empty .st-empty { padding: 24px 0 48px; }
.st-venues-empty .st-empty img { width: 240px; margin-bottom: 24px; }
.st-venues-empty .st-empty p { font-size: 17px; }
@media (max-width: 760px) {
  .st-venues-empty { min-height: calc(100vh - 56px - 24px - 32px - 48px); }
  .st-venues-empty .st-empty img { width: 200px; }
  .st-venues-empty .st-empty .st-actions { flex-direction: column; align-self: stretch; }
}

/* Settings · Team (src/routes/app.settings.team.tsx): the role as text with a dot, the row's ⋯ menu, and its inline edits */
.st-team-role { display: inline-flex; align-items: center; white-space: nowrap; }
.st-team-more { width: 56px; text-align: right; }
.st-team-edit { display: grid; gap: 10px; margin-top: 12px; padding: 14px 16px; background: var(--stump-sunk); border-radius: var(--stump-radius-row); max-width: 460px; }
.st-team-edit .st-field { flex-direction: row; align-items: center; gap: 12px; }
.st-team-edit .st-select { min-width: 180px; }
.st-team-confirm { margin: 0; font-weight: 500; color: var(--stump-ink); }
.st-team-handoffs { margin: 0; padding-left: 18px; }
.st-team-handoffs a { color: var(--stump-emerald-text); }
@media (max-width: 900px) {
  .st-table td.st-team-more { position: absolute; top: 8px; right: 0; width: auto; margin: 0; }
  .st-table tr:has(.st-team-more) { position: relative; padding-right: 48px; }
}
`
