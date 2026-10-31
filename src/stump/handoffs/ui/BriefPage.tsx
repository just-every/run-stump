import { Link } from '@tanstack/react-router'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { HydrationUnit } from '../../../base/hydration/unit'
import { me, runAction } from '../../ui/api.ts'
import { Chip, Disc, Outcome, pageName, proofText, useLoaded } from '../../ui/kit.tsx'
import { extractUrls } from '../../lib/text/index.ts'
import { Icon, type IconName } from '../../ui/icons.tsx'
import { handoffStyles } from './styles.ts'
import { briefTitle, dayOf, dueLine, LAPSE_AT, limitLine, ruleLines, say, STATE, zoneOf, type Handoff } from './words.ts'

const key = () => crypto.randomUUID()

/** Runs one action at a time and keeps its outcome in plain words that name what a refusal names. */
function useAct() {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  async function act<T>(work: () => Promise<T>, done: string): Promise<T | undefined> {
    setBusy(true); setMessage(null)
    try { const value = await work(); setMessage({ text: done, error: false }); return value }
    catch (cause) { setMessage({ text: say(cause), error: true }); return undefined }
    finally { setBusy(false) }
  }
  return { busy, message, act, setMessage }
}

/** The disclosure's shield, drawn like the kit's line icons (the kit has no shield). */
const Shield = () => <span className="st-disc" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" focusable="false">
  <path d="M12 3.5 5 6.2v5.3c0 4.3 2.9 7.6 7 9 4.1-1.4 7-4.7 7-9V6.2z" /><path d="m9 12 2.2 2.2L15.5 10" /></svg></span>

/** One side panel: a heading with its disc at 1440, a row that opens at 390. */
function Side({ icon, title, children }: { icon: IconName | 'shield'; title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false), id = `ho-${title.toLowerCase().replace(/\W+/g, '-')}`
  const disc = icon === 'shield' ? <Shield /> : <Disc icon={icon} />
  return <section className={`st-ho-card${open ? ' open' : ''}`} aria-labelledby={id}>
    <button className="st-ho-toggle" type="button" aria-expanded={open} aria-controls={`${id}-body`} onClick={() => setOpen(!open)}>
      {disc}{title}<span className="st-ho-chevron" aria-hidden="true"><Icon name="chevronRight" /></span></button>
    <h2 className="st-panel-title" id={id}>{disc}{title}</h2>
    <div className="st-ho-body" id={`${id}-body`}>{children}</div>
  </section>
}

/** A hand-off's brief (SPEC §4.2): the draft or talking points first, then the rules with their sources, why it fits, the facts and the disclosure. */
export function BriefPage({ handoffId }: { handoffId: string }) {
  const { data, error, refresh } = useLoaded(async () => {
    const [who, handoff] = await Promise.all([me(), runAction<Handoff>('stump.handoffs.manage', { action: 'get', handoff_id: handoffId })])
    return { who, handoff }
  })
  const handoff = data?.handoff
  return <HydrationUnit>
    <style>{handoffStyles}</style>
    <section className="st-page st-handoffs" aria-labelledby="brief-title">
      <Link className="st-back" to="/app/handoffs">← Hand-offs</Link>
      {error ? <p className="st-error" role="alert">{error}</p> : null}
      {handoff ? <>
        <header className="st-ho-head">
          <h1 id="brief-title">{briefTitle(handoff)}</h1>
          <p className="st-ho-sub">
            {/* The company's own limit for the venue, shared by everyone who posts there, belongs with when it is due. */}
            <span>{[handoff.state === 'posted' ? `Posted ${dayOf(handoff.posted_at)}` : dueLine(handoff.due_at, zoneOf(handoff)), handoff.person_name, limitLine(handoff.venue.shared_limit)].filter(Boolean).join(' · ')}</span>
            {/* Posted says itself once, in the line before it: the notice under it carries the link, with no second "Posted". */}
            {handoff.state !== 'open' && handoff.state !== 'posted' ? <Chip tone={STATE[handoff.state]!.tone} tick={STATE[handoff.state]!.tick}>{STATE[handoff.state]!.label}</Chip> : null}
          </p>
        </header>
        <Notice handoff={handoff} mine={handoff.person_id === data.who.person.id} onChanged={refresh} />
        <div className="st-ho-grid">
          <Work handoff={handoff} mine={handoff.person_id === data.who.person.id} viewer={data.who.person.id} editor={['owner', 'admin', 'editor'].includes(data.who.person.role)} onChanged={refresh} />
          <div className="st-ho-side">
            <Side icon="ledger" title="Rules">
              {ruleLines(handoff.rules as never).map(line => <div className="st-ho-rule" key={line.key}>
                <span>{line.text}</span>
                <span className="st-ho-rule-source">{line.rule.sourced && line.rule.source_url
                  ? <><a href={line.rule.source_url} target="_blank" rel="noreferrer noopener">source</a> · read {dayOf(`${line.rule.read_at}T12:00:00Z`)}</>
                  : <Chip tone="held">unsourced</Chip>}</span>
              </div>)}
            </Side>
            {handoff.why ? <Side icon="check" title="Why it fits"><p>{handoff.why}</p></Side> : null}
            <Side icon="ledger" title="Facts">
              {handoff.facts.length ? handoff.facts.map(fact => <p className="st-ho-fact" key={fact.claim_id}>{fact.text}{proofWords(fact.proof) ? <span className="st-ho-proof"> ({proofWords(fact.proof)})</span> : null}</p>)
                : <p className="st-ho-proof">No current claims with proof for this product.</p>}
            </Side>
            <Side icon="shield" title="Disclosure"><p>{handoff.disclosure_line}</p></Side>
          </div>
        </div>
      </> : null}
    </section>
  </HydrationUnit>
}

/** A fact's proof named by its page ("changelog"), or by its own words. */
const proofWords = (proof: unknown): string | null => {
  if (typeof proof === 'string') { const { url, words } = proofText(proof); return words || (url ? pageName(url) : null) }
  if (proof && typeof proof === 'object') { const value = proof as { text?: string; document?: string; url?: string }; return value.text ?? value.document ?? (value.url ? pageName(value.url) : null) }
  return null
}

/** What the person needs to know before the draft: join first, a hold and its review date, or that it is posted. */
function Notice({ handoff, mine, onChanged }: { handoff: Handoff; mine: boolean; onChanged(): void }) {
  const { busy, message, act } = useAct()
  if (handoff.state === 'join_first') return <div className="st-ho-notice" role="note">
    <h2>Join {handoff.venue.name} first</h2>
    <ol>{handoff.join_steps.map(step => <li key={step}>{step}</li>)}</ol>
  </div>
  if (handoff.state === 'held' && handoff.hold) return <div className="st-ho-notice held" role="note">
    <h2>Held</h2>
    <p>{handoff.hold.kind === 'rule' ? handoff.hold.reason : `${handoff.hold.by_name ?? 'Someone'}${handoff.hold.agent ? ` (${handoff.hold.agent.name})` : ''}: ${handoff.hold.reason}`}</p>
    {handoff.hold.review_at ? <p>{LAPSE_AT[handoff.lapse ?? 'expire']} {dueLine(handoff.hold.review_at, zoneOf(handoff)).replace(/^Due /, '')}.</p> : null}
    {handoff.hold.next_open_at ? <p>{handoff.venue.name} next has room {dayOf(handoff.hold.next_open_at)}.</p> : null}
    {handoff.hold.kind === 'person' ? <div className="st-actions">
      <button className="st-button" type="button" disabled={busy} onClick={() => void act(() => runAction('stump.handoffs.manage', { action: 'release', handoff_id: handoff.id, idempotency_key: key(), expected_revision: handoff.revision }), 'Back in the queue.').then(done => { if (done) onChanged() })}>Release</button>
    </div> : null}
    <Outcome message={message} />
  </div>
  if (handoff.state === 'posted') {
    // The claim check ran on the words recorded: a sentence no claim on record backs is named, so someone can back it or correct the post.
    const unbacked = ([...handoff.history].reverse().find(entry => entry.to === 'posted')?.detail.unbacked as Array<{ text: string }> | undefined) ?? []
    return <div className="st-ho-notice" role="note">
      <p><a href={handoff.url!} target="_blank" rel="noreferrer noopener">{handoff.url!.replace(/^https?:\/\/(www\.)?/, '')}</a> · {handoff.confirmation === 'network' ? 'checked with the network' : `confirmed by ${mine ? 'you' : handoff.person_name}`} · on the <a href="/app/ledger">ledger</a></p>
      {unbacked.length ? <p>No claim on record backs {unbacked.map(item => `“${item.text}”`).join(' or ')}</p> : null}
    </div>
  }
  if (handoff.state === 'skipped' || handoff.state === 'expired') {
    const last = [...handoff.history].reverse().find(entry => entry.to === handoff.state)
    // The state is on the chip above; the notice gives the reason, when one was given.
    return last?.detail.reason ? <div className="st-ho-notice" role="note"><p>{String(last.detail.reason)}</p></div> : null
  }
  return null
}

/**
 * Whether a draft already carries this hand-off's tagged link: a link in it with the same utm_content. The brief then offers
 * no second link beside it; a draft without one, or talking points, keep the link field to paste from.
 */
function carriesLink(text: string, link: string): boolean {
  const tag = new URL(link).searchParams.get('utm_content')
  return extractUrls(text, { bare: false }).some(match => {
    try { return new URL(match.url).searchParams.get('utm_content') === tag } catch { return false }
  })
}

/** The draft (or talking points and the person's own words), copy and open, then paste the link back. */
/**
 * Whose words the draft is: "In Maya's voice" only when it was written through the AI provider with her voice guide; any other
 * draft names who wrote it ("Written by Dana laptop agent for Dana Reyes", "Written by you").
 */
function draftedBy(handoff: Handoff, viewer: string): string {
  const drafted = handoff.drafted
  if (!drafted) return ''
  if (drafted.in_voice) return `In ${(handoff.person_name ?? '').split(/\s+/)[0] || 'their'}'s voice`
  const yours = drafted.by.person_id === viewer, person = yours ? 'you' : drafted.by.name ?? 'someone who left'
  const who = handoff.agent ? yours ? `your agent, ${handoff.agent.name}` : `${handoff.agent.name} for ${person}` : person
  return drafted.ai ? `AI draft, prepared by ${who}` : `Written by ${who}`
}

function Work({ handoff, mine, viewer, editor, onChanged }: { handoff: Handoff; mine: boolean; viewer: string; editor: boolean; onChanged(): void }) {
  const [draft, setDraft] = useState(handoff.draft_text ?? ''), [own, setOwn] = useState(''), [url, setUrl] = useState(''), [attest, setAttest] = useState(false)
  const [skipping, setSkipping] = useState(false), [reason, setReason] = useState('')
  const { busy, message, act, setMessage } = useAct()
  useEffect(() => { setDraft(handoff.draft_text ?? '') }, [handoff.draft_text])
  const open = handoff.state === 'open', working = ['open', 'join_first', 'held'].includes(handoff.state) && (mine || editor)
  const thread = handoff.thread_url ?? handoff.venue.url
  const copyText = handoff.draft_text === null ? own : draft
  // The tagged link shows on its own only when the text to copy does not already hold it.
  const share = working && handoff.link && !(handoff.draft_text !== null && carriesLink(draft, handoff.link)) ? handoff.link : null

  async function save() {
    if (draft === (handoff.draft_text ?? '') || !draft.trim()) return
    const done = await act(() => runAction('stump.handoffs.manage', { action: 'edit', handoff_id: handoff.id, draft_text: draft, idempotency_key: key(), expected_revision: handoff.revision }), 'Saved')
    if (done) onChanged()
  }
  async function copy(value = copyText, done = 'Copied') {
    try { await navigator.clipboard.writeText(value); setMessage({ text: done, error: false }) }
    catch { setMessage({ text: 'Select the text and copy it.', error: true }) }
  }
  async function recordLink(event?: FormEvent) {
    event?.preventDefault()
    if (!url.trim()) { setMessage({ text: 'Paste the link to your post first.', error: true }); return }
    const done = await act(() => runAction('stump.handoffs.check_link', { action: 'record', handoff_id: handoff.id, url: url.trim(), idempotency_key: key(),
      ...(handoff.draft_text === null && own.trim() ? { own_words: own.trim() } : {}), ...(handoff.attestation_required ? { attest_own_words: attest } : {}) }), 'Recorded. It is on the ledger.')
    if (done) onChanged()
  }
  async function skip(event: FormEvent) {
    event.preventDefault()
    const done = await act(() => runAction('stump.handoffs.manage', { action: 'skip', handoff_id: handoff.id, reason: reason.trim(), idempotency_key: key(), expected_revision: handoff.revision }), 'Skipped.')
    if (done) { setSkipping(false); onChanged() }
  }

  // On a phone the poster's own open hand-off keeps Copy text and Record the link in the sticky bar; Open thread stays in the card.
  return <section className={open && mine && working ? 'st-ho-card st-ho-barred' : 'st-ho-card'} aria-labelledby="draft-title">
    {handoff.draft_text !== null ? <>
      <h2 className="st-panel-title" id="draft-title"><Disc icon="pencil" />Draft</h2>
      <p className="st-ho-voice">{draftedBy(handoff, viewer)}</p>
      {/* Only the person who posts it (or an editor) works on the draft; once posted, skipped or expired it reads as the text it is. */}
      {working ? <textarea className="st-ho-draft" aria-labelledby="draft-title" value={draft} onChange={event => setDraft(event.target.value)} onBlur={() => void save()} />
        : <div className="st-ho-words"><p>{handoff.draft_text}</p></div>}
    </> : <>
      <h2 className="st-panel-title" id="draft-title"><Disc icon="pencil" />Talking points</h2>
      <p className="st-ho-voice">{handoff.attestation_required ? 'Say it in your own words; Stump writes no text for you here.' : `${handoff.venue.name} takes no AI-written text.`}</p>
      <ul className="st-ho-points">{handoff.talking_points.map(point => <li key={point}>{point}</li>)}</ul>
      {working ? <label className="st-field">Your own words
        <textarea className="st-ho-draft" value={own} onChange={event => setOwn(event.target.value)} placeholder="Write what you will post." style={{ minHeight: 160 }} /></label>
        // Once posted, the words that went out, as the poster recorded them.
        : handoff.own_words ? <div className="st-ho-words"><h3>{mine ? 'Your own words' : `${(handoff.person_name ?? '').split(/\s+/)[0] || 'Their'}'s own words`}</h3><p>{handoff.own_words}</p></div> : null}
    </>}
    {/* The product's link tagged for this hand-off: pasted into the post, the signups it brings join to it on the ledger. */}
    {share ? <div className="st-ho-share">
      <input readOnly aria-label="Your link" value={share} onFocus={event => event.currentTarget.select()} />
      <button className="st-button" type="button" onClick={() => void copy(share, 'Link copied')}>Copy link</button>
    </div> : null}
    {working ? <>
      <div className="st-ho-buttons">
        <button className="st-button primary st-ho-copy" type="button" onClick={() => void copy()} disabled={!copyText}>Copy text</button>
        {thread ? <a className="st-button outline" href={thread} target="_blank" rel="noreferrer noopener">Open thread ↗</a> : null}
      </div>
      {open && mine ? <form className="st-ho-link" onSubmit={recordLink}>
        <input type="url" inputMode="url" aria-label="Paste the link" placeholder="Paste the link" value={url} onChange={event => setUrl(event.target.value)} />
        <button className="st-button primary" type="submit" disabled={busy}>Record the link</button>
        {!skipping ? <button className="st-ho-quiet" type="button" onClick={() => setSkipping(true)}>Skip</button> : null}
      </form> : null}
      {open && mine && handoff.attestation_required ? <label className="st-ho-attest"><input type="checkbox" checked={attest} onChange={event => setAttest(event.target.checked)} />These are my own words.</label> : null}
      {!(open && mine) && !skipping ? <div className="st-ho-link"><button className="st-ho-quiet" type="button" onClick={() => setSkipping(true)}>Skip</button></div> : null}
      {skipping ? <form className="st-ho-skip" onSubmit={skip}>
        <label className="st-field">Why skip it<input value={reason} required maxLength={500} onChange={event => setReason(event.target.value)} /></label>
        <div className="st-actions"><button className="st-button" type="submit" disabled={busy}>Skip</button><button className="st-ho-quiet" type="button" onClick={() => setSkipping(false)}>Keep it</button></div>
      </form> : null}
      <Outcome message={message} />
      {open && mine ? <div className="st-ho-bar">
        <button className="st-button primary" type="button" onClick={() => void copy()} disabled={!copyText}>Copy text</button>
        <button className="st-button primary" type="button" disabled={busy} onClick={() => void recordLink()}>Record the link</button>
      </div> : null}
    </> : <Outcome message={message} />}
  </section>
}
