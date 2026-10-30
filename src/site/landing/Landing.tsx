import type { ReactNode } from 'react'
import { Footer } from '../shell/Footer'
import { Header } from '../shell/Header'
import { links } from '../shell/links'
import '../styles/site.css'
import '../styles/landing.css'

// The homepage (final design SPEC §2): every word is live text over pastel
// plates that carry none.

const Check = () => <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
const Tick = ({ size = 'md' }: { size?: 'sm' | 'md' }) => <span className={`lp-tick lp-tick--${size}`} aria-hidden="true"><Check /></span>
const Arrow = () => <span aria-hidden="true" className="lp-arrow">→</span>

function Actions({ className = '' }: { className?: string }) {
  return <div className={`lp-actions ${className}`}>
    <a className="site-pill site-pill--large" href={links.run}>Run Stump <Arrow /></a>
    <a className="lp-textlink" href={links.docs}>Read the docs</a>
  </div>
}

function Hero() {
  return <section className="lp-hero" aria-labelledby="lp-title">
    <img className="lp-hero-plate" src="/art/stump-hero.webp" alt="" width="896" height="526" fetchPriority="high" />
    <div className="site-wrap lp-hero-copy">
      <h1 id="lp-title">Be heard in your own voice.</h1>
      <p className="lp-sub">Stump turns your changelog into posts for the communities worth showing up in, then shows which posts brought signups.</p>
      <p className="lp-switch">An alternative to <strong>Hootsuite</strong>, <strong>Buffer</strong> and <strong>Brand24</strong></p>
      <Actions />
    </div>
    <div className="site-wrap">
      <ol className="lp-steps" aria-label="Stump at work: a release drafted for four networks, a hand-off posted by Maya in r/healthIT, and the 38 signups it brought.">
        <li className="lp-card lp-step">
          <div className="lp-step-head"><span className="lp-num" aria-hidden="true">1</span><p className="lp-step-title">Drafted</p></div>
          <p className="lp-step-main">Brightwell 3.2: recurring bookings, set once.</p>
          <ul className="lp-chips" aria-label="Networks"><li>Bluesky</li><li>X</li><li>LinkedIn</li><li>Mastodon</li></ul>
          <p className="lp-step-foot"><Tick />4 claims checked</p>
        </li>
        <li className="lp-card lp-step">
          <div className="lp-step-head"><span className="lp-num" aria-hidden="true">2</span><p className="lp-step-title">Handed off</p></div>
          <p className="lp-step-main">r/healthIT · Maya posts by hand</p>
          <p className="lp-step-quiet">Disclosure: I'm a founder at Brightwell.</p>
          <p className="lp-step-foot"><Tick />Posted · link recorded</p>
        </li>
        <li className="lp-card lp-step">
          <div className="lp-step-head"><span className="lp-num" aria-hidden="true">3</span><p className="lp-step-title">Signups</p></div>
          <p className="lp-step-main">Maya Chen · r/healthIT</p>
          <p className="lp-big"><span>38</span> signups</p>
        </li>
      </ol>
    </div>
  </section>
}

const TUFT = { left: { width: 235, height: 201 }, right: { width: 175, height: 226 } }

/** One band: a 5/12 text column beside a 7/12 card, the sides alternating. */
function Band({ id, eyebrow, title, children, card, flip, tuft }: { id: string; eyebrow?: string; title: ReactNode; children: ReactNode; card: ReactNode; flip?: boolean; tuft: 'left' | 'right' }) {
  return <section className={flip ? 'lp-band lp-band--flip' : 'lp-band'} aria-labelledby={id}>
    <div className="site-wrap lp-band-grid">
      <div className="lp-band-text">
        {eyebrow ? <p className="lp-eyebrow">{eyebrow}</p> : null}
        <h2 id={id}>{title}</h2>
        <p className="lp-body">{children}</p>
      </div>
      <div className="lp-band-card">
        <img className={`lp-tuft lp-tuft--${tuft}`} src={`/art/tuft-${tuft}.webp`} alt="" {...TUFT[tuft]} loading="lazy" />
        {card}
      </div>
    </div>
  </section>
}

const Pill = ({ kind = 'ink', children }: { kind?: 'ink' | 'outline'; children: ReactNode }) => <span className={`lp-pill lp-pill--${kind}`}>{children}</span>

function Venues() {
  const rows: Array<[string, string | null, string | null]> = [['r/healthIT', 'Members post', 'AI text banned'], ['Indie Hackers', null, 'Ready'], ['Hacker News', 'Show HN by hand', null], ['Healthcare IT Today', 'Editorial', null]]
  return <div className="lp-card lp-feature">
    <p className="lp-card-title">Venue register</p>
    <ul className="lp-rows">{rows.map(([name, meta, chip]) => <li key={name}><span className="lp-row-text"><span className="lp-row-name">{name}</span>{meta ? <span className="lp-row-meta">{meta}</span> : null}</span>{chip ? <span className="lp-chip">{chip}</span> : null}</li>)}</ul>
  </div>
}

function Composer() {
  const variants: Array<[string, string]> = [['Bluesky', '196 / 300'], ['X', '212 / 280'], ['LinkedIn', '640 / 3,000'], ['Mastodon', '196 / 500']]
  return <div className="lp-card lp-feature">
    <p className="lp-master">Brightwell 3.2 is out: recurring bookings, set once.</p>
    <ul className="lp-variants">{variants.map(([network, count]) => <li key={network}><span className="lp-variant-name">{network}</span><span className="lp-variant-count">{count}</span></li>)}</ul>
    <Pill>Schedule all</Pill>
  </div>
}

function Handoff() {
  return <div className="lp-card lp-feature">
    <p className="lp-card-title">Post in: r/healthIT weekly thread</p>
    <p className="lp-label">Rules</p>
    <ul className="lp-rules">
      <li><Tick size="sm" /><span>Members post</span><span className="lp-row-meta">source · read Oct 28</span></li>
      <li><Tick size="sm" /><span>One self-promotion post a week</span><span className="lp-row-meta">source · read Oct 28</span></li>
    </ul>
    <div className="lp-hairline" />
    <p className="lp-small">Facts: Recurring bookings in 3.2 (changelog)</p>
    <p className="lp-small">Disclosure: I'm a founder at Brightwell.</p>
    <div className="lp-pills"><Pill>Copy text</Pill><Pill kind="outline">Record the link</Pill></div>
  </div>
}

function Inbox() {
  return <div className="lp-card lp-feature">
    <p className="lp-card-title">Ask HN: Scheduling for a small clinic?</p>
    <ul className="lp-chips lp-chips--quiet"><li>asks a question</li><li>fits Brightwell</li><li>fresh</li></ul>
    <Pill>Draft a reply</Pill>
    <div className="lp-hairline" />
    <div className="lp-reply"><div><p className="lp-reply-who">@drlinh replied:</p><p className="lp-small">Does 3.2 handle every-other-week?</p></div><Pill kind="outline">Reply</Pill></div>
  </div>
}

function Ledger() {
  const rows: Array<[string, string, string, string]> = [['Oct 27', 'r/healthIT', 'Maya Chen', '38'], ['Oct 27', 'Bluesky', 'Stump agent for Sam Ortiz', '12'], ['Oct 26', 'LinkedIn', 'Maya Chen', '9']]
  return <div className="lp-card lp-feature lp-ledger">
    <table>
      <thead><tr><th scope="col">When</th><th scope="col">Where</th><th scope="col">Who</th><th scope="col">State</th><th scope="col">Signups</th></tr></thead>
      <tbody>{rows.map(([when, where, who, signups]) => <tr key={where}><td>{when}</td><td>{where}</td><td>{who}</td><td><span className="lp-chip">Posted</span></td><td className="lp-signups">{signups}</td></tr>)}</tbody>
    </table>
  </div>
}

function Standards() {
  return <div className="lp-card lp-feature">
    <ul className="lp-checks">
      <li><Tick /><div><p className="lp-check-title">3 claims matched</p><p className="lp-row-meta">Recurring bookings · changelog</p></div></li>
      <li><Tick /><div><p className="lp-check-title">Disclosure added</p><p className="lp-row-meta">I'm a founder at Brightwell.</p></div></li>
    </ul>
  </div>
}

function Terminal() {
  return <div className="lp-terminal" data-copy-scope>
    <p className="lp-command"><span className="lp-prompt" aria-hidden="true">&gt; </span><code>npx -y @runeditrun/rer cli install</code></p>
    <span className="lp-tip">
      <button type="button" className="lp-copy" data-copy aria-label="Copy command" hidden>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="8" y="8" width="11" height="11" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.75" /><path d="M5 15V6.5A1.5 1.5 0 0 1 6.5 5H15" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" /></svg>
      </button>
      <span role="tooltip">Copy command</span>
    </span>
  </div>
}

function Details() {
  const tiles: Array<[string, string]> = [['Pause in one press', 'pause'], ['Switch from Buffer', 'switch-from-buffer'], ['Your AI provider', 'ai-provider'], ['Tracked links', 'links'], ['Orbit and Vane', 'stack'], ['Export and erase', 'data']]
  return <section className="lp-details" aria-labelledby="lp-details">
    <div className="site-wrap">
      <h2 id="lp-details">The quiet details.</h2>
      <ul className="lp-tiles">{tiles.map(([title, slug]) => <li key={slug}><a className="lp-card lp-tile" href={links.doc(slug)}><Tick /><span>{title}</span></a></li>)}</ul>
    </div>
  </section>
}

function Closing() {
  return <section className="lp-closing" aria-labelledby="lp-closing">
    <div className="site-wrap lp-closing-grid">
      <div className="lp-closing-copy">
        <h2 id="lp-closing">Go be heard.</h2>
        <Actions />
      </div>
      <img className="lp-closing-plate" src="/art/stump-close.webp" alt="" width="1016" height="640" loading="lazy" />
    </div>
  </section>
}

export function Landing() {
  return <div className="site-page">
    <Header />
    <main id="main">
      <Hero />
      <Band id="lp-venues" eyebrow="VENUES" title="Know where to show up." card={<Venues />} tuft="right">Every community, newsletter, podcast and journalist worth your time, with its rules and their sources. Stump reads the rules before every post and picks the route they allow.</Band>
      <Band id="lp-composer" eyebrow="COMPOSER" title={<>One post, <span className="lp-keep">every network.</span></>} card={<Composer />} flip tuft="left">Write it once. Stump opens a variant for Bluesky, X, LinkedIn and Mastodon, counts each the way the network does, and schedules them all with one press.</Band>
      <Band id="lp-handoffs" eyebrow="HAND-OFFS" title="Members post by hand." card={<Handoff />} tuft="right">Where a venue keeps posting for its members, the named member gets a brief, the facts with proof and a draft in their own voice. They paste the link back; the ledger has it.</Band>
      <Band id="lp-inbox" eyebrow="INBOX & LISTENING" title="Answer the people who asked." card={<Inbox />} flip tuft="left">Stump watches Hacker News, feeds, Bluesky and Mastodon for threads worth answering, and brings replies from people who engaged with you first.</Band>
      <Band id="lp-ledger" eyebrow="LEDGER" title="See which posts paid off." card={<Ledger />} tuft="right">Every post and hand-off is on the record with its link, author and tagged links. With Vane, each one shows the signups it brought.</Band>
      <Band id="lp-standards" eyebrow="STANDARDS" title="Your real voice, every time." card={<Standards />} flip tuft="left">Stump speaks only as real people and the company. It adds the disclosure, checks every claim against its proof and holds near-duplicates until they are rewritten.</Band>
      <Band id="lp-yours" title="Yours, start to finish." card={<Terminal />} tuft="right">Your own network apps and keys, your own AI provider, your team's real accounts. Take everything with you any time.</Band>
      <Details />
      <Closing />
    </main>
    <Footer />
  </div>
}
