// The Listening screen's own rules, in the app's tokens (src/stump/ui/styles.ts). Every rule is scoped to
// .st-listen, so the shared st-* classes keep their values on every other screen; it adds no colours.
export const listeningStyles = `
.st-listen { max-width: 1120px; }
.st-listen-grid { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: calc(var(--stump-space) * 3); align-items: start; margin-top: calc(var(--stump-space) * 3); }
.st-listen .st-card { border: 1px solid var(--stump-hairline); border-radius: var(--stump-radius); padding: calc(var(--stump-space) * 3); background: var(--stump-white); min-width: 0; margin: 0; }
.st-listen .st-card h2 { margin: 0 0 calc(var(--stump-space) * 2); }
.st-listen .st-card-head { display: flex; align-items: center; justify-content: space-between; gap: calc(var(--stump-space) * 2); flex-wrap: wrap; margin-bottom: calc(var(--stump-space) * 2); }
.st-listen .st-card-head h2 { margin: 0; }
.st-listen .st-watches { list-style: none; margin: 0 0 calc(var(--stump-space) * 2); padding: 0; display: grid; gap: 4px; }
.st-listen .st-watch { display: flex; align-items: center; gap: calc(var(--stump-space) * 1.5); width: 100%; text-align: left; font: inherit; color: inherit; background: transparent; border: 0; border-radius: var(--stump-radius-row); padding: calc(var(--stump-space) * 1.25); cursor: pointer; min-height: 56px; }
.st-listen .st-watch:hover { background: var(--stump-sunk); }
.st-listen .st-watch[aria-current="true"] { background: var(--stump-emerald-tint); }
.st-listen .st-watch:focus-visible, .st-listen .st-pick:focus-visible, .st-listen .st-finding-title:focus-visible, .st-listen .st-open-link:focus-visible { outline: 2px solid var(--stump-focus); outline-offset: 2px; }
/* An unselected watch is an empty ring; the selected one an emerald tick disc. */
.st-listen .st-watch-mark { flex: none; width: 22px; height: 22px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px #B9C2BC; display: inline-flex; align-items: center; justify-content: center; color: var(--stump-white); }
.st-listen .st-watch-mark svg { width: 13px; height: 13px; }
.st-listen .st-watch[aria-current="true"] .st-watch-mark { background: var(--stump-emerald); box-shadow: none; }
.st-listen .st-watch-main { flex: 1 1 auto; min-width: 0; }
.st-listen .st-watch-name { font-weight: 600; overflow-wrap: anywhere; color: var(--stump-ink); }
.st-listen .st-pick { display: none; font: inherit; font-size: var(--stump-size-body); font-weight: 600; color: var(--stump-ink); background: var(--stump-emerald-tint); border: 0; border-radius: 999px; padding: 10px 16px; min-height: 44px; width: 100%; box-sizing: border-box; }
.st-listen .st-findings { list-style: none; margin: 0; padding: 0; display: grid; gap: calc(var(--stump-space) * 1.5); }
.st-listen .st-finding { display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; gap: calc(var(--stump-space) * 1.5) calc(var(--stump-space) * 2); border: 1px solid var(--stump-hairline); border-radius: var(--stump-radius); padding: calc(var(--stump-space) * 2.5); position: relative; }
.st-listen .st-finding.focal { background: var(--stump-focus-tint); border-color: transparent; }
.st-listen .st-numeral { width: 32px; height: 32px; border-radius: 50%; background: var(--stump-emerald); color: var(--stump-white); display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-size: 15px; }
.st-listen .st-finding h3 { margin: 0; font-size: var(--stump-size-section); font-weight: 600; line-height: 1.3; overflow-wrap: anywhere; color: var(--stump-ink); }
.st-listen .st-finding-title { font: inherit; color: inherit; text-align: left; background: none; border: 0; padding: 0; cursor: pointer; }
.st-listen .st-finding-title:hover { text-decoration: underline; text-underline-offset: 3px; }
.st-listen .st-finding-body { min-width: 0; display: grid; gap: var(--stump-space); }
.st-listen .st-chips { display: flex; flex-wrap: wrap; gap: var(--stump-space); margin: 0; padding: 0; list-style: none; }
.st-listen .st-finding .st-chip { background: var(--stump-white); color: var(--stump-ink); }
.st-listen .st-finding:not(.focal) .st-chip { background: var(--stump-sunk); color: var(--stump-muted); }
.st-listen .st-finding-actions { display: flex; align-items: center; gap: calc(var(--stump-space) * 2.5); flex-wrap: wrap; margin-top: var(--stump-space); }
.st-listen .st-open-link { color: var(--stump-muted); font-size: 15px; font-weight: 500; text-decoration: none; padding: 6px 0; }
.st-listen .st-open-link:hover { color: var(--stump-ink); text-decoration: underline; text-underline-offset: 3px; }
.st-listen .st-finding-work { display: grid; gap: calc(var(--stump-space) * 1.5); margin-top: var(--stump-space); padding-top: calc(var(--stump-space) * 2); border-top: 1px solid var(--stump-hairline); }
.st-listen .st-finding-work textarea { font: inherit; font-size: var(--stump-size-body); min-height: 96px; padding: 10px 12px; resize: vertical; }
.st-listen .st-finding-flags { list-style: none; margin: 0; padding: 0; color: var(--stump-danger); font-size: var(--stump-size-small); }
.st-listen .st-more-menu { align-self: start; }
.st-listen .st-banner { background: var(--stump-sunk); border-radius: var(--stump-radius); padding: calc(var(--stump-space) * 1.5) calc(var(--stump-space) * 2); margin-bottom: calc(var(--stump-space) * 2); font-size: var(--stump-size-small); font-weight: 500; }
.st-listen .st-banner.error { color: var(--stump-danger); }
.st-listen .st-editor { display: grid; gap: calc(var(--stump-space) * 2.5); }
.st-listen .st-editor fieldset { border: 0; padding: 0; margin: 0; display: grid; gap: calc(var(--stump-space) * 1.5); min-width: 0; }
.st-listen .st-editor legend { font-weight: 600; padding: 0; margin-bottom: var(--stump-space); }
.st-listen .st-editor .st-field input, .st-listen .st-editor .st-field select { width: 100%; }
.st-listen .st-check { display: flex; align-items: center; gap: var(--stump-space); font-size: var(--stump-size-body); }
.st-listen .st-check input { width: 20px; height: 20px; margin: 0; }
.st-listen .st-source-box { display: grid; gap: var(--stump-space); padding: calc(var(--stump-space) * 1.5) 0; border-top: 1px solid var(--stump-hairline); }
.st-listen .st-blocked { display: flex; flex-wrap: wrap; gap: var(--stump-space); }
.st-listen .st-blocked .st-button { min-height: 36px; padding: 4px 12px; }
.st-listen .st-listen-none { color: var(--stump-muted); padding: calc(var(--stump-space) * 3) 0; margin: 0; }
.st-listen .st-listen-first { max-width: 720px; margin-top: calc(var(--stump-space) * 3); }
.st-listen .st-listen-next { margin: 0 0 calc(var(--stump-space) * 2); }
.st-listen .st-chip-more { display: inline-flex; align-items: center; }
.st-listen .st-finding:not(.focal) .st-finding-body { gap: 4px; }
.st-listen .st-finding:not(.focal) .st-chips { margin-top: 4px; }
@media (max-width: 760px) {
  .st-listen-grid { grid-template-columns: minmax(0, 1fr); gap: calc(var(--stump-space) * 2); margin-top: calc(var(--stump-space) * 2); }
  .st-listen .st-watches-list { display: none; }
  .st-listen .st-pick { display: block; }
  .st-listen .st-new-watch { display: none; }
  .st-listen .st-card { padding: calc(var(--stump-space) * 2); }
  .st-listen .st-card[aria-label="Your watches"] { border: 0; padding: 0; }
  .st-listen .st-card[aria-label="Your watches"] > h2 { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  /* The findings sit on the column under the watch picker: no outer panel, one border per finding. */
  .st-listen .st-card[aria-label="Top findings"] { border: 0; padding: 0; }
  .st-listen .st-finding h3 { font-size: 17px; line-height: 24px; }
  .st-listen .st-finding { grid-template-columns: minmax(0, 1fr) auto; padding: calc(var(--stump-space) * 2); }
  .st-listen .st-numeral { display: none; }
  .st-listen .st-finding-body { grid-column: 1; }
  .st-listen .st-finding-actions .st-button { flex: 1 1 auto; }
}
`
