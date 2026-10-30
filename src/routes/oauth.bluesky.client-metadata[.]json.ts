import { createFileRoute } from '@tanstack/react-router'
import { buildClientMetadata } from '../stump/lib/bluesky/index.ts'

// Stump's atproto OAuth client metadata (https://atproto.com/specs/oauth): a
// deployed installation's client_id is this document's own address, so a PDS
// can read who is asking. A local installation is a loopback client instead.
export const Route = createFileRoute('/oauth/bluesky/client-metadata.json')({
  server: {
    handlers: {
      GET: ({ request }) => {
        const origin = new URL(request.url).origin
        const metadata = buildClientMetadata({
          clientId: `${origin}/oauth/bluesky/client-metadata.json`, clientName: 'Stump', clientUri: origin,
          redirectUris: [`${origin}/app/connected/bluesky`], clientAuth: { method: 'none' },
        })
        return Response.json(metadata, { headers: { 'cache-control': 'public, max-age=300' } })
      },
    },
  },
})
