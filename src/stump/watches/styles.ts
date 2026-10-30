// The Listening screen's own rules, in the app's tokens (src/stump/ui/styles.ts); it adds no colours.
export const listeningStyles = `
.st-listen { max-width: 1120px; }
.st-listen-grid { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: calc(var(--stump-space) * 3); align-items: start; margin-top: calc(var(--stump-space) * 3); }
.st-card { border: 1px solid var(--stump-line); border-radius: 14px; padding: calc(var(--stump-space) * 3); background: var(--stump-column); min-width: 0; }
.st-card h2 { margin: 0 0 calc(var(--stump-space) * 2); }
.st-card-head { display: flex; align-items: center; justify-content: space-between; gap: calc(var(--stump-space) * 2); flex-wrap: wrap; margin-bottom: calc(var(--stump-space) * 2); }
.st-card-head h2 { margin: 0; }
.st-watches { list-style: none; margin: 0 0 calc(var(--stump-space) * 2); padding: 0; }
.st-watch { display: flex; align-items: center; gap: calc(var(--stump-space) * 1.5); width: 100%; text-align: left; font: inherit; color: inherit; background: transparent; border: 0; border-radius: 12px; padding: calc(var(--stump-space) * 1.25); cursor: pointer; min-height: 56px; }
.st-watch:hover { background: var(--stump-sunk); }
.st-watch[aria-current="true"] { background: color-mix(in srgb, var(--stump-accent) 10%, var(--stump-column)); }
.st-watch:focus-visible, .st-more-button:focus-visible, .st-pick:focus-visible { outline: 2px solid var(--stump-focus); outline-offset: 1px; }
.st-tick { flex: none; width: 24px; height: 24px; border-radius: 50%; border: 2px solid var(--stump-line); box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; color: var(--stump-accent-text); }
.st-watch[aria-current="true"] .st-tick { background: var(--stump-accent); border-color: var(--stump-accent); }
.st-watch-main { flex: 1 1 auto; min-width: 0; }
.st-watch-name { font-weight: 560; overflow-wrap: anywhere; }
.st-pick { display: none; font: inherit; font-size: var(--stump-size-body); color: var(--stump-text); background: color-mix(in srgb, var(--stump-accent) 10%, var(--stump-column)); border: 0; border-radius: 999px; padding: 10px 16px; min-height: 44px; width: 100%; box-sizing: border-box; }
.st-findings { list-style: none; margin: 0; padding: 0; display: grid; gap: calc(var(--stump-space) * 1.5); }
.st-finding { display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; gap: calc(var(--stump-space) * 1.5) calc(var(--stump-space) * 2); border: 1px solid var(--stump-line); border-radius: 14px; padding: calc(var(--stump-space) * 2.5); position: relative; }
.st-finding.focal { background: color-mix(in srgb, var(--stump-accent) 8%, var(--stump-column)); border-color: transparent; }
.st-numeral { width: 32px; height: 32px; border-radius: 50%; background: var(--stump-accent); color: var(--stump-accent-text); display: inline-flex; align-items: center; justify-content: center; font-weight: 600; font-size: var(--stump-size-small); }
.st-finding h3 { margin: 0; font-size: var(--stump-size-section); font-weight: 560; line-height: 1.3; overflow-wrap: anywhere; }
.st-finding-body { min-width: 0; display: grid; gap: var(--stump-space); }
.st-chips { display: flex; flex-wrap: wrap; gap: var(--stump-space); margin: 0; padding: 0; list-style: none; }
.st-chip { font-size: var(--stump-size-small); background: color-mix(in srgb, var(--stump-accent) 12%, var(--stump-column)); border-radius: 999px; padding: 3px 12px; }
.st-chip.route { background: transparent; border: 1px solid var(--stump-line); color: var(--stump-accent); font-weight: 560; }
.st-chip.quiet { background: var(--stump-sunk); color: var(--stump-muted); }
.st-button.st-open { text-decoration: none; display: inline-flex; align-items: center; line-height: 1.2; }
.st-open-link { color: var(--stump-text); font-size: var(--stump-size-body); font-weight: 560; text-decoration: none; padding: 6px 0; }
.st-open-link:hover { text-decoration: underline; }
.st-finding-actions { display: flex; align-items: center; gap: var(--stump-space); flex-wrap: wrap; margin-top: var(--stump-space); }
.st-more { position: relative; align-self: start; }
.st-more-button { font: inherit; font-size: var(--stump-size-section); line-height: 1; border: 0; background: transparent; border-radius: 8px; width: 40px; height: 40px; cursor: pointer; color: var(--stump-text); }
.st-more-button:hover { background: var(--stump-sunk); }
.st-more .st-menu { position: absolute; right: 0; top: 44px; z-index: 5; background: var(--stump-column); border: 1px solid var(--stump-line); border-radius: 12px; padding: 6px; min-width: 170px; box-shadow: 0 8px 24px rgba(0,0,0,.08); display: grid; }
.st-more .st-menu button { font: inherit; font-size: var(--stump-size-body); text-align: left; background: transparent; border: 0; border-radius: 8px; padding: 9px 12px; min-height: 40px; cursor: pointer; color: var(--stump-text); }
.st-more .st-menu button:hover, .st-more .st-menu button:focus-visible { background: var(--stump-sunk); outline: none; }
.st-listen .st-banner { background: var(--stump-sunk); border-radius: var(--stump-radius); padding: calc(var(--stump-space) * 1.5) calc(var(--stump-space) * 2); margin-bottom: calc(var(--stump-space) * 2); font-size: var(--stump-size-small); }
.st-listen .st-banner.error { color: var(--stump-danger); }
.st-editor { display: grid; gap: calc(var(--stump-space) * 2.5); }
.st-editor fieldset { border: 0; padding: 0; margin: 0; display: grid; gap: calc(var(--stump-space) * 1.5); min-width: 0; }
.st-editor legend { font-weight: 600; padding: 0; margin-bottom: var(--stump-space); }
.st-editor .st-field input, .st-editor .st-field select { width: 100%; }
.st-check { display: flex; align-items: center; gap: var(--stump-space); font-size: var(--stump-size-body); }
.st-check input { width: 20px; height: 20px; margin: 0; }
.st-source-box { display: grid; gap: var(--stump-space); padding: calc(var(--stump-space) * 1.5) 0; border-top: 1px solid var(--stump-line); }
.st-blocked { display: flex; flex-wrap: wrap; gap: var(--stump-space); }
.st-blocked .st-button { min-height: 34px; padding: 4px 12px; }
.st-empty { color: var(--stump-muted); padding: calc(var(--stump-space) * 3) 0; }
@media (max-width: 760px) {
  .st-listen-grid { grid-template-columns: minmax(0, 1fr); }
  .st-watches-list { display: none; }
  .st-pick { display: block; }
  .st-card { padding: calc(var(--stump-space) * 2); }
  .st-finding { grid-template-columns: minmax(0, 1fr) auto; }
  .st-numeral { display: none; }
  .st-finding-body { grid-column: 1; }
}
`
