// The ledger and connections screens' own classes, built only from the --stump-* tokens
// so a restyle of the tokens restyles them too. Every rule is scoped to the two screens'
// .st-ledger-screen, so the shared st-* classes keep their values everywhere else.
export const screenStyles = `
.st-ledger-screen .st-bar { display: flex; gap: var(--stump-space); align-items: center; flex-wrap: wrap; margin: 0 0 calc(var(--stump-space) * 2); }
.st-ledger-screen .st-bar .st-search-field { flex: 1 1 260px; }
.st-ledger-screen .st-search { font: inherit; font-size: var(--stump-size-body); color: var(--stump-text); background: var(--stump-white); border: 1px solid var(--stump-field); border-radius: var(--stump-radius-field); padding: 8px 14px; min-height: 44px; box-sizing: border-box; min-width: 0; }
.st-ledger-screen .st-search:focus { outline: 2px solid var(--stump-focus); outline-offset: 2px; }
.st-ledger-screen .st-chips { margin: 0 0 calc(var(--stump-space) * 2); }
.st-ledger-screen button.st-chip { cursor: pointer; border: 0; font-family: inherit; }
.st-ledger-screen button.st-chip:focus-visible { outline: 2px solid var(--stump-focus); outline-offset: 2px; }
.st-ledger-screen .st-chip .st-dot { margin: 0; }
.st-ledger-screen .st-table td { overflow-wrap: anywhere; }
.st-ledger-screen .st-table td.when { white-space: nowrap; }
.st-ledger-screen .st-table td.state .st-chip { vertical-align: middle; }
.st-ledger-screen .st-table tr.open > td { border-bottom-color: transparent; }
.st-ledger-screen .st-table .st-quiet { display: block; margin-top: 4px; font-size: var(--stump-size-small); color: var(--stump-muted); }
.st-ledger-screen .st-table a { color: var(--stump-emerald-text); font-weight: 500; text-decoration: none; }
.st-ledger-screen .st-table a:hover { text-decoration: underline; text-underline-offset: 3px; }
.st-ledger-screen .st-table td.st-phone { display: none; }
.st-ledger-screen .st-row-button { font: inherit; text-align: left; background: none; border: 0; padding: 0; color: inherit; cursor: pointer; }
.st-ledger-screen .st-row-button:hover { text-decoration: underline; text-underline-offset: 3px; }
.st-ledger-screen .st-row-button:focus-visible { outline: 2px solid var(--stump-focus); outline-offset: 2px; border-radius: 4px; }
.st-ledger-screen .st-detail { background: var(--stump-sunk); border-radius: var(--stump-radius); padding: calc(var(--stump-space) * 2.5); display: grid; gap: calc(var(--stump-space) * 2); }
.st-ledger-screen .st-detail h3 { margin: 0 0 4px; font-size: var(--stump-size-body); font-weight: 600; }
.st-ledger-screen .st-detail pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; background: var(--stump-white); border-radius: 10px; padding: 10px 12px; }
.st-ledger-screen .st-versions { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--stump-space); }
.st-ledger-screen .st-versions li { background: var(--stump-white); border-radius: 10px; padding: 8px 12px; }
.st-ledger-screen .st-field textarea { font: inherit; font-size: var(--stump-size-body); color: var(--stump-text); background: var(--stump-white); border: 1px solid var(--stump-field); border-radius: var(--stump-radius-field); padding: 8px 10px; min-height: 88px; box-sizing: border-box; resize: vertical; }
.st-ledger-screen .st-field textarea:focus { outline: 2px solid var(--stump-focus); outline-offset: 2px; }
.st-ledger-screen .st-show-more { margin: calc(var(--stump-space) * 2) 0; }
.st-ledger-screen .st-panel .st-button:not(.primary):not(.danger), .st-ledger-screen .st-detail .st-button:not(.primary):not(.danger) { background: var(--stump-white); }
.st-ledger-screen .st-panel .st-actions, .st-ledger-screen .st-detail .st-actions { margin-top: calc(var(--stump-space) * 1.5); }
@media (max-width: 760px) {
  .st-ledger-screen .st-bar .st-search-field { flex-basis: 100%; }
  /* The phone list (SPEC §4.2 Ledger): "Where · Who" over "When · Route · State", the link at the right. */
  .st-ledger-screen .st-table tr.entry { display: block; padding: 12px 16px; }
  .st-ledger-screen .st-table tr.entry > td { display: none; }
  .st-ledger-screen .st-table tr.entry > td.st-phone { display: flex; align-items: center; gap: 12px; margin: 0; width: 100%; }
  .st-ledger-screen .st-phone .st-row-button { flex: 1 1 auto; min-width: 0; min-height: 44px; display: grid; gap: 2px; }
  .st-ledger-screen .st-phone-main { font-weight: 600; color: var(--stump-ink); overflow-wrap: anywhere; }
  .st-ledger-screen .st-phone-meta { font-size: var(--stump-size-small); color: var(--stump-muted); }
  .st-ledger-screen .st-phone a { flex: none; min-height: 44px; display: inline-flex; align-items: center; }
  .st-ledger-screen .st-table tr.detail-row > td { padding: 0 16px 12px; }
}
/* At phone width the toolbar follows Venues: search and Filters share the first row, Export CSV is a full-width pill under them. */
@media (max-width: 480px) {
  .st-ledger-screen .st-bar .st-search-field { flex: 1 1 0; min-width: 0; }
  .st-ledger-screen .st-bar > .st-button { flex: none; }
  .st-ledger-screen .st-bar > .st-button.primary { flex: 1 1 100%; }
}
`
