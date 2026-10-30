import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { HydrationUnit } from '../base/hydration/unit'
import { shownHandle } from '../stump/accounts/handle.ts'
import { explain, runAction } from '../stump/ui/api.ts'

export const Route = createFileRoute('/app/connected/$network')({ component: Connected })

const NAMES: Record<string, string> = { bluesky: 'Bluesky', mastodon: 'Mastodon', x: 'X', linkedin: 'LinkedIn' }

interface Outcome { ok: boolean; account_id?: string; code?: string; message?: unknown; owner?: { name?: string } }
interface Listed { items: Array<{ id: string; network: string; handle: string }>; connection?: { outcome: Outcome | null } }

const WORDS: Record<string, string> = {
  consent_not_yours: 'Someone else started this connection. Start your own from Accounts.',
  consent_used: 'This connection was already finished.',
  consent_expired: 'The connection took too long. Start it again from Accounts.',
  consent_declined: 'The network says access was not allowed.',
  network_mismatch: 'This answer belongs to a different network. Start again from Accounts.',
  not_found: 'Stump has no connection waiting for this answer. Start again from Accounts.',
}

/** The network's own words, or who already owns the account, before the generic explanation. */
function reason(outcome: Outcome): string {
  if (outcome.code === 'account_owned' && outcome.owner?.name) return `That account is already connected in Stump, owned by ${outcome.owner.name}.`
  if (typeof outcome.message === 'string') return outcome.message
  return WORDS[outcome.code ?? ''] ?? `Refused: ${(outcome.code ?? 'unknown').replace(/_/g, ' ')}.`
}

/**
 * Where the server sends the person once it has finished a connection from the
 * network's consent screen (src/stump/accounts/callback.ts). This page only
 * shows what happened; it never finishes a connection itself.
 */
function Connected() {
  const { network } = Route.useParams()
  const [result, setResult] = useState<{ ok: true; handle: string } | { ok: false; text: string } | { ok: null } | null>(null)
  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    const connection = query.get('connection'), refused = query.get('refused')
    if (refused) { setResult({ ok: false, text: reason({ ok: false, code: refused }) }); return }
    if (!connection) { setResult({ ok: null }); return }
    runAction<Listed>('stump.accounts.connect', { action: 'list', connection_id: connection })
      .then(listed => {
        const outcome = listed.connection?.outcome
        const account = outcome?.ok ? listed.items.find(item => item.id === outcome.account_id) : undefined
        setResult(account ? { ok: true, handle: shownHandle(account) } : { ok: false, text: outcome ? reason(outcome) : WORDS.not_found! })
      })
      .catch(error => setResult({ ok: false, text: explain(error) }))
  }, [])
  const name = NAMES[network] ?? network
  const title = !result ? `Connecting ${name}` : result.ok ? `${result.handle} is connected` : result.ok === null ? `Connect ${name}` : `${name} was not connected`
  const lead = !result ? 'Reading what the network answered.' : result.ok ? `Stump can now post to this ${name} account.`
    : result.ok === null ? 'Start a connection from Accounts.' : result.text
  return <HydrationUnit>
    <section className="st-page" aria-labelledby="connected-title">
      <h1 id="connected-title">{title}</h1>
      <p className="st-lead">{lead}</p>
      <p><a className="st-button primary" href="/app/settings/accounts">Back to accounts</a></p>
    </section>
  </HydrationUnit>
}
