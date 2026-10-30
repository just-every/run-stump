// The hand-off screens' own classes (SPEC §4.2 Hand-offs and A hand-off's brief),
// scoped under .st-handoffs and built only from the --stump-* tokens, so a
// restyle of the tokens restyles them too.
export const handoffStyles = `
.st-handoffs .st-ho-toolbar { margin: 0 0 24px; }
.st-handoffs .st-ho-list { list-style: none; margin: 0; padding: 0 24px; background: var(--stump-white); border: 1px solid var(--stump-hairline); border-radius: var(--stump-radius); }
.st-handoffs .st-ho-row { border-top: 1px solid var(--stump-hairline); }
.st-handoffs .st-ho-row:first-child { border-top: 0; }
.st-handoffs .st-ho-row a { display: flex; align-items: center; gap: 16px; min-height: 88px; padding: 16px 0; color: inherit; text-decoration: none; }
.st-handoffs .st-ho-row a:focus-visible { outline: 2px solid var(--stump-emerald); outline-offset: 2px; border-radius: 8px; }
.st-handoffs .st-ho-row a:hover .st-ho-name { text-decoration: underline; }
.st-handoffs .st-ho-main { flex: 1 1 auto; min-width: 0; }
.st-handoffs .st-ho-name { font-size: 17px; line-height: 24px; font-weight: 600; color: var(--stump-ink); overflow-wrap: anywhere; }
.st-handoffs .st-ho-meta { font-size: var(--stump-size-small); line-height: 20px; color: var(--stump-muted); margin-top: 4px; }
.st-handoffs .st-ho-head { margin: 0 0 32px; }
.st-handoffs .st-ho-head h1 { overflow-wrap: anywhere; }
.st-handoffs .st-ho-sub { color: var(--stump-muted); font-size: 16px; margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
.st-handoffs .st-ho-grid { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 24px; align-items: start; }
.st-handoffs .st-ho-side { display: grid; gap: 16px; }
.st-handoffs .st-ho-card { background: var(--stump-white); border: 1px solid var(--stump-hairline); border-radius: var(--stump-radius); padding: 24px; min-width: 0; }
.st-handoffs .st-ho-card h2 { margin: 0; }
.st-handoffs .st-ho-voice { color: var(--stump-muted); font-size: var(--stump-size-small); margin: 2px 0 16px 50px; }
.st-handoffs .st-ho-draft { display: block; width: 100%; box-sizing: border-box; font: inherit; font-size: 17px; line-height: 1.6; color: var(--stump-text); background: var(--stump-sunk); border: 1px solid var(--stump-hairline); border-radius: var(--stump-radius-field); padding: 16px; min-height: 220px; resize: vertical; field-sizing: content; }
.st-handoffs .st-ho-draft:focus-visible, .st-handoffs .st-ho-link input:focus-visible { outline: 2px solid var(--stump-emerald); outline-offset: 2px; }
.st-handoffs .st-ho-points { margin: 0 0 16px; padding-left: 20px; display: grid; gap: 8px; }
.st-handoffs .st-ho-buttons { display: flex; flex-wrap: wrap; gap: 12px; margin: 20px 0 0; }
.st-handoffs .st-ho-link { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin: 16px 0 0; }
.st-handoffs .st-ho-link input { flex: 1 1 220px; min-width: 0; min-height: 44px; font: inherit; font-size: var(--stump-size-body); color: var(--stump-text); background: var(--stump-white); border: 1px solid var(--stump-field-border); border-radius: var(--stump-pill); padding: 0 18px; }
.st-handoffs .st-ho-quiet { background: none; border: 0; font: inherit; font-size: 15px; font-weight: 600; color: var(--stump-emerald-text); cursor: pointer; min-height: 44px; padding: 0 8px; }
.st-handoffs .st-ho-quiet:focus-visible { outline: 2px solid var(--stump-emerald); outline-offset: 2px; border-radius: 6px; }
.st-handoffs .st-ho-attest { display: flex; gap: 10px; align-items: center; margin: 16px 0 0; min-height: 44px; font-size: 15px; }
.st-handoffs .st-ho-attest input { width: 20px; height: 20px; accent-color: var(--stump-emerald); }
.st-handoffs .st-ho-rule { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 10px 0; border-top: 1px solid var(--stump-hairline); }
.st-handoffs .st-ho-rule:first-child { border-top: 0; }
.st-handoffs .st-ho-rule-source { font-size: var(--stump-size-small); color: var(--stump-muted); white-space: nowrap; }
.st-handoffs .st-ho-body { margin-top: 16px; }
.st-handoffs .st-ho-body p { margin: 0; }
.st-handoffs .st-ho-fact + .st-ho-fact { margin-top: 10px; }
.st-handoffs .st-ho-proof { color: var(--stump-muted); }
.st-handoffs .st-ho-toggle { display: none; }
.st-handoffs .st-ho-notice { background: var(--stump-focus-tint); border-radius: var(--stump-radius); padding: 20px 24px; margin: 0 0 24px; }
.st-handoffs .st-ho-notice.held { background: var(--stump-held-tint); }
.st-handoffs .st-ho-notice h2 { margin: 0 0 8px; font-size: var(--stump-size-section); }
.st-handoffs .st-ho-notice ol { margin: 8px 0 0; padding-left: 20px; display: grid; gap: 6px; }
.st-handoffs .st-ho-notice p { margin: 0; }
.st-handoffs .st-ho-notice .st-actions { margin-top: 12px; }
.st-handoffs .st-ho-skip { display: grid; gap: 12px; margin: 16px 0 0; }
.st-handoffs .st-ho-bar { display: none; }
@media (max-width: 760px) {
  .st-handoffs .st-ho-list { padding: 0 16px; }
  .st-handoffs .st-ho-row a { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; min-height: 0; }
  .st-handoffs .st-ho-row a .st-chip { justify-self: start; }
  .st-handoffs .st-ho-head { margin-bottom: 24px; }
  .st-handoffs .st-ho-grid { grid-template-columns: minmax(0, 1fr); gap: 16px; }
  .st-handoffs .st-ho-card { padding: 16px; }
  .st-handoffs .st-ho-voice { margin-left: 50px; }
  .st-handoffs .st-ho-draft { font-size: 17px; min-height: 180px; }
  .st-handoffs .st-ho-buttons { display: none; }
  .st-handoffs .st-ho-link .st-button { display: none; }
  .st-handoffs .st-ho-side .st-ho-card { padding: 4px 16px; }
  .st-handoffs .st-ho-side h2 { display: none; }
  .st-handoffs .st-ho-toggle { display: flex; align-items: center; gap: 14px; width: 100%; min-height: 56px; padding: 6px 0; background: none; border: 0; font: inherit; font-size: var(--stump-size-section); font-weight: 600; color: var(--stump-ink); text-align: left; cursor: pointer; }
  .st-handoffs .st-ho-toggle:focus-visible { outline: 2px solid var(--stump-emerald); outline-offset: 2px; border-radius: 6px; }
  .st-handoffs .st-ho-toggle .st-ho-chevron { margin-left: auto; transition: transform var(--stump-motion); }
  .st-handoffs .st-ho-toggle[aria-expanded="true"] .st-ho-chevron { transform: rotate(90deg); }
  .st-handoffs .st-ho-side .st-ho-card:not(.open) .st-ho-body { display: none; }
  .st-handoffs .st-ho-side .st-ho-body { margin: 4px 0 16px; }
  .st-handoffs .st-ho-rule { flex-direction: column; gap: 2px; }
  .st-handoffs .st-ho-bar { display: flex; position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; gap: 12px; align-items: center; padding: 14px 16px calc(14px + env(safe-area-inset-bottom)); min-height: 72px; box-sizing: border-box; background: var(--stump-white); border-top: 1px solid var(--stump-hairline); }
  .st-handoffs:has(.st-ho-bar) { padding-bottom: 88px; }
  .st-handoffs .st-ho-bar .st-button { flex: 1 1 0; }
}
`
