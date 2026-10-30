import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { HydrationUnit } from '../base/hydration/unit'
import { ActionError, explain, runAction } from '../stump/ui/api.ts'

export const Route = createFileRoute('/app/connected/$network')({ component: Connected })

const NAMES: Record<string, string> = { bluesky: 'Bluesky', mastodon: 'Mastodon', x: 'X', linkedin: 'LinkedIn' }

/** The network's own words, or who already owns the account, before the generic explanation. */
function reason(error: unknown): string {
  if (error instanceof ActionError) {
    const owner = (error.fields.owner as { name?: string } | undefined)?.name
    if (error.code === 'account_owned' && owner) return `That account is already connected in Stump, owned by ${owner}.`
    if (typeof error.fields.message === 'string') return error.fields.message
  }
  return explain(error)
}

/**
 * Where a network's consent screen sends the person back. The page finishes
 * the connection as the signed-in person who started it, once, and forgets
 * the code so a reload cannot repeat it.
 */
function Connected() {
  const { network } = Route.useParams()
  const [result, setResult] = useState<{ ok: true; handle: string } | { ok: false; text: string } | null>(null)
  const sent = useRef(false)
  useEffect(() => {
    if (sent.current) return
    sent.current = true
    const query = new URLSearchParams(window.location.search)
    window.history.replaceState(null, '', window.location.pathname)
    const value = (name: string) => query.get(name) ?? undefined
    const args = { action: 'complete', idempotency_key: crypto.randomUUID(), state: value('state'), code: value('code'), iss: value('iss'), error: value('error') }
    runAction<{ account: { handle: string } }>('stump.accounts.connect', Object.fromEntries(Object.entries(args).filter(([, item]) => item !== undefined)))
      .then(done => setResult({ ok: true, handle: done.account.handle }))
      .catch(error => setResult({ ok: false, text: reason(error) }))
  }, [])
  const name = NAMES[network] ?? network
  return <HydrationUnit>
    <section className="st-page" aria-labelledby="connected-title">
      <h1 id="connected-title">{result?.ok ? `${result.handle} is connected` : result ? `${name} was not connected` : `Connecting ${name}`}</h1>
      <p className="st-lead">{result?.ok ? `Stump can now post to this ${name} account.` : result ? result.text : 'Finishing the connection with the network.'}</p>
      <p><a className="st-button primary" href="/app/settings/accounts">Back to accounts</a></p>
    </section>
  </HydrationUnit>
}
