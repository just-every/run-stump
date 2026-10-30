// The ledger and connections screens' own classes, built only from the --stump-* tokens
// so a restyle of the tokens restyles them too.
export const screenStyles = `
.st-bar { display: flex; gap: var(--stump-space); align-items: center; flex-wrap: wrap; margin: 0 0 calc(var(--stump-space) * 2); }
.st-bar .st-search { flex: 1 1 260px; }
.st-search { font: inherit; font-size: var(--stump-size-body); color: var(--stump-text); background: var(--stump-column); border: 1px solid var(--stump-field); border-radius: 8px; padding: 8px 12px; min-height: 40px; box-sizing: border-box; min-width: 0; }
.st-search:focus { outline: 2px solid var(--stump-focus); outline-offset: 1px; }
.st-chips { display: flex; gap: var(--stump-space); flex-wrap: wrap; margin: 0 0 calc(var(--stump-space) * 2); }
.st-chip { display: inline-flex; align-items: center; gap: 6px; font: inherit; font-size: var(--stump-size-small); line-height: 1.3; padding: 4px 10px; border: 0; border-radius: 999px; background: var(--stump-sunk); color: var(--stump-text); white-space: nowrap; }
button.st-chip { cursor: pointer; }
button.st-chip:focus-visible { outline: 2px solid var(--stump-focus); outline-offset: 1px; }
.st-chip.good { background: color-mix(in srgb, var(--stump-accent) 14%, var(--stump-column)); }
.st-chip.bad { background: color-mix(in srgb, var(--stump-danger) 12%, var(--stump-column)); color: var(--stump-danger); }
.st-table { width: 100%; border-collapse: collapse; }
.st-table th { text-align: left; font-size: var(--stump-size-small); font-weight: 600; color: var(--stump-muted); padding: 8px 12px 8px 0; background: var(--stump-column); }
.st-table td { padding: calc(var(--stump-space) * 1.5) 12px calc(var(--stump-space) * 1.5) 0; border-top: 1px solid var(--stump-line); vertical-align: top; overflow-wrap: anywhere; }
.st-table tr.open > td { border-top-color: var(--stump-text); }
.st-table .st-quiet { display: block; font-size: var(--stump-size-small); color: var(--stump-muted); }
.st-row-button { font: inherit; text-align: left; background: none; border: 0; padding: 0; color: inherit; cursor: pointer; }
.st-row-button:hover { text-decoration: underline; }
.st-row-button:focus-visible { outline: 2px solid var(--stump-focus); outline-offset: 2px; border-radius: 4px; }
.st-detail { background: var(--stump-sunk); border-radius: var(--stump-radius); padding: calc(var(--stump-space) * 2.5); display: grid; gap: calc(var(--stump-space) * 2); }
.st-detail h3 { margin: 0 0 4px; font-size: var(--stump-size-body); font-weight: 620; }
.st-detail pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; background: var(--stump-column); border-radius: 8px; padding: 10px 12px; }
.st-versions { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--stump-space); }
.st-versions li { background: var(--stump-column); border-radius: 8px; padding: 8px 12px; }
.st-field textarea { font: inherit; font-size: var(--stump-size-body); color: var(--stump-text); background: var(--stump-column); border: 1px solid var(--stump-field); border-radius: 8px; padding: 8px 10px; min-height: 88px; box-sizing: border-box; resize: vertical; }
.st-field textarea:focus { outline: 2px solid var(--stump-focus); outline-offset: 1px; }
.st-more { margin: calc(var(--stump-space) * 2) 0; }
.st-panel .st-button:not(.primary):not(.danger), .st-detail .st-button:not(.primary):not(.danger) { background: var(--stump-column); }
.st-panel .st-actions, .st-detail .st-actions { margin-top: calc(var(--stump-space) * 1.5); }
@media (max-width: 760px) {
  .st-table, .st-table tbody, .st-table tr, .st-table td { display: block; }
  .st-table thead { display: none; }
  .st-table tr.entry { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; padding: calc(var(--stump-space) * 1.5) 0; border-top: 1px solid var(--stump-line); }
  .st-table tr.entry > td { border: 0; padding: 0; }
  .st-table tr.entry > td.where { order: 1; flex: 1 1 0; min-width: 0; font-weight: 600; }
  .st-table tr.entry > td.link { order: 2; }
  .st-table tr.entry > td.who { order: 3; flex: 0 0 100%; color: var(--stump-muted); font-size: var(--stump-size-small); }
  .st-table tr.entry > td.when, .st-table tr.entry > td.route, .st-table tr.entry > td.state { font-size: var(--stump-size-small); color: var(--stump-muted); }
  .st-table tr.entry > td.when { order: 4; }
  .st-table tr.entry > td.route { order: 5; }
  .st-table tr.entry > td.route::before, .st-table tr.entry > td.state::before { content: "\\00b7"; margin-right: 8px; }
  .st-table tr.entry > td.state { order: 6; display: flex; flex-wrap: wrap; align-items: center; gap: 0 8px; }
  .st-table tr.entry > td.state .st-quiet { flex-basis: 100%; }
  .st-table tr.detail-row > td { border: 0; padding: 0 0 calc(var(--stump-space) * 1.5); }
}
`
