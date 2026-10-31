// The Inbox screen's own rules (SPEC §4.2 Inbox), scoped to .st-inbox and built
// only from the app's tokens in src/stump/ui/styles.ts; it adds no colours.
export const inboxStyles = `
.st-inbox { max-width: 1120px; }
.st-inbox .st-inbox-bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: -16px 0 24px; }
.st-inbox .st-inbox-bar .st-meta { margin-right: auto; }
.st-inbox .st-inbox-bar .st-button { margin-left: auto; }
.st-inbox .st-inbox-bar .st-inbox-check-icon { display: none; }
.st-inbox .st-inbox-grid { display: grid; grid-template-columns: 360px minmax(0, 1fr); gap: 16px; align-items: start; }
.st-inbox .st-inbox-list { list-style: none; margin: 0; padding: 0; border: 1px solid var(--stump-hairline); border-radius: var(--stump-radius); overflow: hidden; background: var(--stump-white); }
.st-inbox .st-inbox-list li + li { border-top: 1px solid var(--stump-hairline); }
.st-inbox .st-inbox-row { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; column-gap: 14px; row-gap: 6px; align-items: baseline; width: 100%; text-align: left; font: inherit; color: var(--stump-ink); background: var(--stump-white); border: 0; padding: 20px 18px 20px 18px; cursor: pointer; min-height: 88px; }
.st-inbox .st-inbox-row:hover { background: var(--stump-sunk); }
.st-inbox .st-inbox-row[aria-current="true"] { background: var(--stump-focus-tint); }
.st-inbox .st-inbox-row:focus-visible { outline: 2px solid var(--stump-emerald); outline-offset: -2px; }
.st-inbox .st-inbox-row .st-dot { margin: 0; align-self: center; grid-row: 1; }
.st-inbox .st-inbox-row .st-dot.off { visibility: hidden; }
.st-inbox .st-inbox-handle { font-weight: 600; font-size: 17px; line-height: 22px; overflow-wrap: anywhere; }
.st-inbox .st-inbox-time { font-size: var(--stump-size-small); color: var(--stump-muted); white-space: nowrap; }
.st-inbox .st-inbox-line { grid-column: 2 / 4; font-size: 15px; line-height: 20px; color: var(--stump-body); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st-inbox .st-inbox-open { border: 1px solid var(--stump-hairline); border-radius: var(--stump-radius); background: var(--stump-white); padding: 24px; min-width: 0; display: grid; gap: 20px; }
.st-inbox .st-inbox-who { display: flex; align-items: center; gap: 16px; }
.st-inbox .st-inbox-who .st-initials { width: 48px; height: 48px; background: var(--stump-emerald-tint); color: var(--stump-ink); }
.st-inbox .st-inbox-who .st-name { font-weight: 600; font-size: 18px; }
.st-inbox .st-inbox-quote { background: var(--stump-sunk); border-radius: 12px; padding: 18px 20px; display: grid; gap: 8px; min-width: 0; }
.st-inbox .st-inbox-quote-head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: baseline; }
.st-inbox .st-inbox-quote p { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.st-inbox .st-inbox-text { margin: 0; font-size: 18px; line-height: 27px; color: var(--stump-ink); overflow-wrap: anywhere; white-space: pre-wrap; }
.st-inbox .st-inbox-rule { border: 0; border-top: 1px solid var(--stump-hairline); margin: 0; }
.st-inbox .st-inbox-compose { display: grid; gap: 12px; }
.st-inbox .st-inbox-compose textarea { font: inherit; font-size: var(--stump-size-body); color: var(--stump-ink); background: var(--stump-white); border: 1px solid var(--stump-field-border); border-radius: var(--stump-radius-field); padding: 12px 14px; min-height: 112px; width: 100%; box-sizing: border-box; resize: vertical; }
.st-inbox .st-inbox-compose textarea:focus-visible { outline: 2px solid var(--stump-emerald); outline-offset: 2px; }
.st-inbox .st-inbox-checks { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; font-size: var(--stump-size-small); }
.st-inbox .st-inbox-checks li { display: flex; gap: 8px; align-items: baseline; }
.st-inbox .st-inbox-checks li.bad { color: var(--stump-danger); }
.st-inbox .st-inbox-checks li.ok { color: var(--stump-emerald-text); }
.st-inbox .st-inbox-checks li.bad { flex-wrap: wrap; align-items: center; }
.st-inbox .st-inbox-add-line { border: 0; font: inherit; font-size: var(--stump-size-small); line-height: 20px; border-radius: var(--stump-pill); padding: 3px 10px; background: var(--stump-emerald-tint); color: var(--stump-emerald-text); cursor: pointer; white-space: nowrap; }
.st-inbox .st-inbox-add-line:focus-visible { outline: 2px solid var(--stump-emerald); outline-offset: 2px; }
.st-inbox .st-inbox-count { justify-self: end; }
.st-inbox .st-inbox-actions { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
.st-inbox .st-inbox-actions .st-button { min-height: 48px; padding: 0 32px; }
.st-inbox .st-inbox-reply { background: var(--stump-focus-tint); border-radius: 12px; padding: 16px 18px; display: grid; gap: 8px; }
.st-inbox .st-inbox-reply p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.st-inbox .st-inbox-reply a { color: var(--stump-emerald-text); }
.st-inbox .st-inbox-back { display: none; }
.st-inbox .st-visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (max-width: 900px) {
  .st-inbox .st-inbox-bar { margin: -8px 0 16px; }
  .st-inbox .st-inbox-grid { grid-template-columns: minmax(0, 1fr); }
  .st-inbox .st-inbox-row { min-height: 76px; padding: 16px; }
  .st-inbox.reading .st-inbox-list, .st-inbox.reading .st-inbox-bar, .st-inbox.reading > h1, .st-inbox.reading > .st-lead { display: none; }
  .st-inbox:not(.reading) .st-inbox-open { display: none; }
  .st-inbox .st-inbox-back { display: inline-flex; align-items: center; gap: 8px; font: inherit; font-size: var(--stump-size-body); color: var(--stump-ink); background: none; border: 0; padding: 0 8px 0 0; min-height: 44px; cursor: pointer; justify-self: start; }
  .st-inbox .st-inbox-back svg { transform: rotate(180deg); }
  .st-inbox .st-inbox-open { padding: 16px; gap: 16px; }
  .st-inbox .st-inbox-text { font-size: 17px; line-height: 25px; }
  .st-inbox .st-inbox-actions { position: sticky; bottom: 0; margin: 0 -16px -16px; padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); background: var(--stump-white); box-shadow: inset 0 1px 0 var(--stump-hairline); border-radius: 0 0 var(--stump-radius) var(--stump-radius); }
  .st-inbox .st-inbox-actions { gap: 8px; flex-wrap: nowrap; }
  .st-inbox .st-inbox-actions .st-button { flex: 1 1 auto; padding: 0 14px; min-height: 52px; }
  .st-inbox .st-inbox-row.st-inbox-first[aria-current="true"] { background: var(--stump-white); }
}
@media (max-width: 480px) {
  .st-inbox .st-inbox-bar { flex-wrap: nowrap; gap: 8px; }
  .st-inbox .st-inbox-bar .st-meta { min-width: 0; }
  .st-inbox .st-inbox-bar .st-inbox-check { display: none; }
  .st-inbox .st-inbox-bar .st-inbox-check-icon { display: inline-flex; flex: none; margin-left: auto; }
}
`
