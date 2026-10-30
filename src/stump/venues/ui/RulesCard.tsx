import { useState } from 'react'
import { runAction } from '../../ui/api.ts'
import { Outcome, useRun } from '../../ui/kit.tsx'
import { readOn } from './labels.ts'
import type { Rule, RuleKey, Venue } from './types.ts'

const LABELS: Record<RuleKey, string> = { posting: 'Posting', ai_text: 'AI text', self_promotion: 'Self-promotion', links: 'Links', disclosure_line: 'Disclosure line', gates: 'Gates' }
const CHOICES: Partial<Record<RuleKey, Record<string, string>>> = {
  posting: { members_only: 'members only', company_account: 'the company account may post' },
  ai_text: { allowed: 'allowed', allowed_with_disclosure: 'allowed with disclosure', banned: 'banned' },
  self_promotion: { allowed: 'allowed', thread: 'in its thread only', day: 'on one day only', ratio: 'limited by a ratio', banned: 'banned' },
  links: { allowed: 'allowed', banned: 'banned' },
}
const KEYS = Object.keys(LABELS) as RuleKey[]

type Gates = { karma?: number; account_age_days?: number; approval?: boolean; membership?: boolean }
export function ruleWords(key: RuleKey, rule: Rule | null): string {
  if (!rule) return 'not recorded'
  if (key === 'gates') {
    const gates = rule.value as Gates, parts = [gates.karma !== undefined ? `${gates.karma} karma` : null, gates.account_age_days !== undefined ? `account ${gates.account_age_days} days old` : null,
      gates.approval ? 'approval to join' : null, gates.membership ? 'membership' : null].filter(Boolean)
    return parts.join(', ') || 'none'
  }
  if (key === 'disclosure_line') return String(rule.value)
  const word = CHOICES[key]?.[String(rule.value)] ?? String(rule.value)
  return rule.detail ? `${word} (${rule.detail})` : word
}

const key = () => crypto.randomUUID()

/** A venue's six rules, each with its source and read date; each value edits in place and saves as you go (STUMP-VENUE-002.5). */
export function RulesCard({ venue, editor, onSaved }: { venue: Venue; editor: boolean; onSaved(): void }) {
  const [editing, setEditing] = useState<RuleKey | null>(null)
  return <section className="st-card" aria-labelledby="rules-title">
    <h2 id="rules-title">Rules</h2>
    {KEYS.map(name => {
      const rule = venue.rules[name]
      return <div key={name}>
        <div className="st-rule">
          <span className="st-rule-label">{LABELS[name]}</span>
          {editor ? <button className="st-value" type="button" aria-expanded={editing === name} onClick={() => setEditing(editing === name ? null : name)}>{ruleWords(name, rule)}</button>
            : <span>{ruleWords(name, rule)}</span>}
          <span className="st-rule-source">{rule ? rule.sourced
            ? <><a href={rule.source_url!} target="_blank" rel="noreferrer noopener">source ↗</a> · read {readOn(rule.read_at)}</>
            : <span className="st-chip held">unsourced</span> : null}</span>
        </div>
        {editing === name ? <RuleEditor venue={venue} name={name} rule={rule} onSaved={onSaved} onClose={() => setEditing(null)} /> : null}
      </div>
    })}
  </section>
}

function RuleEditor({ venue, name, rule, onSaved, onClose }: { venue: Venue; name: RuleKey; rule: Rule | null; onSaved(): void; onClose(): void }) {
  const { busy, message, run } = useRun()
  const gates = (name === 'gates' ? rule?.value ?? {} : {}) as Gates
  const [value, setValue] = useState<string>(name === 'gates' ? '' : String(rule?.value ?? ''))
  const [source, setSource] = useState(rule?.source_url ?? ''), [readAt, setReadAt] = useState(rule?.read_at ?? '')
  const [detail, setDetail] = useState(rule?.detail ?? '')
  const [gate, setGate] = useState({ karma: gates.karma?.toString() ?? '', age: gates.account_age_days?.toString() ?? '', approval: gates.approval === true })
  const save = (next: Partial<{ value: unknown; source: string; readAt: string; detail: string }> = {}, remove = false) => run(async () => {
    const chosen = next.value ?? (name === 'gates'
      ? Object.fromEntries(Object.entries({ karma: gate.karma ? Number(gate.karma) : undefined, account_age_days: gate.age ? Number(gate.age) : undefined, approval: gate.approval || undefined }).filter(([, item]) => item !== undefined))
      : value)
    const src = (next.source ?? source).trim(), date = next.readAt ?? readAt, extra = (next.detail ?? detail).trim()
    if (!remove && (chosen === '' || (typeof chosen === 'object' && !Object.keys(chosen as object).length))) return
    await runAction('stump.venues.rules', { action: 'set', idempotency_key: key(), venue_id: venue.id, expected_revision: venue.revision,
      rules: { [name]: remove ? null : { value: chosen, source_url: src || null, read_at: date || null, ...(extra ? { detail: extra } : {}) } } })
    onSaved()
  }, () => 'Saved.')
  return <div className="st-panel" role="group" aria-label={`Edit ${LABELS[name]}`}>
    <div className="st-form">
      {CHOICES[name] ? <label className="st-field">Rule<select value={value} disabled={busy} onChange={event => { setValue(event.target.value); void save({ value: event.target.value }) }}>
        <option value="" disabled>Choose…</option>{Object.entries(CHOICES[name]!).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label> : null}
      {name === 'disclosure_line' ? <label className="st-field">Line the venue asks for<input value={value} maxLength={280} onChange={event => setValue(event.target.value)} onBlur={() => void save()} /></label> : null}
      {name === 'self_promotion' ? <label className="st-field">Which thread, day or ratio<input value={detail} maxLength={300} onChange={event => setDetail(event.target.value)} onBlur={() => void save()} /></label> : null}
      {name === 'gates' ? <>
        <label className="st-field">Karma at least<input type="number" min={0} value={gate.karma} onChange={event => setGate({ ...gate, karma: event.target.value })} onBlur={() => void save()} /></label>
        <label className="st-field">Account age in days<input type="number" min={0} value={gate.age} onChange={event => setGate({ ...gate, age: event.target.value })} onBlur={() => void save()} /></label>
        <label className="st-field"><span><input type="checkbox" checked={gate.approval} onChange={event => { const next = { ...gate, approval: event.target.checked }; setGate(next); void save({ value: Object.fromEntries(Object.entries({ karma: next.karma ? Number(next.karma) : undefined, account_age_days: next.age ? Number(next.age) : undefined, approval: next.approval || undefined }).filter(([, item]) => item !== undefined)) }) }} /> Moderators approve new members</span></label>
      </> : null}
      <label className="st-field">Source page<input type="url" value={source} placeholder="https://" maxLength={2048} onChange={event => setSource(event.target.value)} onBlur={() => void save()} /></label>
      <label className="st-field">Read on<input type="date" value={readAt} onChange={event => { setReadAt(event.target.value); void save({ readAt: event.target.value }) }} /></label>
    </div>
    <Outcome message={message} />
    <div className="st-actions">
      <button className="st-button pill" type="button" onClick={onClose}>Done</button>
      {rule ? <button className="st-button danger pill" type="button" disabled={busy} onClick={() => void save({}, true).then(onClose)}>Remove this rule</button> : null}
    </div>
  </div>
}
