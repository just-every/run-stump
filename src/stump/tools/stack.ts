import { refuse } from '../actions/refusals.ts'
import type { ActionContext, StumpTool } from '../actions/types.ts'
import { ADMINS, EDITORS } from '../people/roles.ts'
import { countOffers, dropConnection, listConnections, listOffers, publicOffer, readOffer, saveConnection, sendOffer, type Seed } from '../stack/index.ts'
import { SealError } from '../stack/seal.ts'

const seed = { enum: ['orbit', 'vane'] }
const standard = (measure = 1) => [{ class: 'standard' as const, facts: { measure } }]
const ID = /^[A-Za-z0-9._:-]{1,100}$/

/** The address of a sibling seed: an origin only, https unless this is a local runtime or a loopback address. */
function originOf(raw: string, ctx: ActionContext): string {
  let url: URL
  try { url = new URL(raw) } catch { return refuse('invalid_arguments', { field: 'origin', reason: 'Use the seed\'s web address, like https://orbit.example.com.' }) }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  const loopback = host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host)
  const local = ctx.env.AUTH_LOCAL === 'true'
  if (url.username || url.password || url.search || url.hash || url.pathname.replace(/\/+$/, '') !== '') refuse('invalid_arguments', { field: 'origin', reason: 'Use the address alone, without a path.' })
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) refuse('invalid_arguments', { field: 'origin', reason: 'Use an https address.' })
  if (!local && (loopback || /^(10|127|169\.254|192\.168)\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host))) refuse('invalid_arguments', { field: 'origin', reason: 'Use the address the seed answers on the internet.' })
  return url.origin
}

export const stackTools: StumpTool[] = [{
  name: 'stump.stack.connect', title: 'Connect Orbit and Vane',
  description: 'Connect the company\'s Orbit (the signed signal source engagers are sent through) or Vane (the site whose annotations Stump adds). The secret is sealed and never answered back.',
  scope: 'stump:stack', classes: ['security'], clauses: ['STUMP-STACK-002', 'STUMP-STACK-004'],
  actions: {
    connect: {
      roles: ADMINS,
      properties: {
        seed, origin: { type: 'string', minLength: 8, maxLength: 300 }, source_id: { type: 'string', minLength: 1, maxLength: 100 }, site_id: { type: 'string', minLength: 1, maxLength: 100 },
        secret: { type: 'string', minLength: 20, maxLength: 256, writeOnly: true },
      },
      required: ['seed', 'origin', 'secret'],
      classify: args => [{ class: 'security', facts: { measure: 1, setting: `${String(args.seed)} connection` } }],
      summary: args => ({ target: { name: `Connect ${String(args.seed)}` } }),
      target: args => ({ kind: 'connection', id: String(args.seed) }),
      async run(args, ctx) {
        const which = args.seed as Seed, origin = originOf(String(args.origin), ctx)
        const id = which === 'orbit' ? args.source_id : args.site_id
        if (typeof id !== 'string' || !ID.test(id) || (which === 'orbit' && !/^[A-Za-z0-9_-]{1,80}$/.test(id))) refuse('invalid_arguments', { field: which === 'orbit' ? 'source_id' : 'site_id', reason: `Name the ${which === 'orbit' ? 'signal source' : 'site'} to send to.` })
        const secret = String(args.secret)
        if (/\s/.test(secret) || (which === 'orbit' && secret.length < 32)) refuse('invalid_arguments', { field: 'secret', reason: which === 'orbit' ? 'Orbit signal secrets are at least 32 characters.' : 'Use the site\'s annotation secret exactly as Vane showed it.' })
        let connection
        try { connection = await saveConnection(ctx.env, { seed: which, origin, id, secret, by: ctx.person.id, now: ctx.now() }) } catch (error) {
          if (error instanceof SealError) refuse('installation_key_missing', { reason: error.message })
          throw error
        }
        ctx.emit('stack.connected', `stump://stack/${which}`, { seed: which })
        return connection
      },
    },
    list: {
      roles: EDITORS, read: true,
      classify: () => standard(),
      async run(_args, ctx) { const items = await listConnections(ctx.db); return { items, total: items.length } },
    },
    disconnect: {
      roles: ADMINS,
      properties: { seed }, required: ['seed'],
      classify: args => [{ class: 'security', facts: { measure: 1, setting: `${String(args.seed)} connection` } }],
      summary: args => ({ target: { name: `Disconnect ${String(args.seed)}` } }),
      target: args => ({ kind: 'connection', id: String(args.seed) }),
      async run(args, ctx) {
        const connection = await dropConnection(ctx.db, args.seed as Seed, ctx.now())
        if (!connection) refuse('not_found', { seed: args.seed })
        ctx.emit('stack.disconnected', `stump://stack/${String(args.seed)}`, { seed: args.seed })
        return connection
      },
    },
  },
}, {
  name: 'stump.stack.send', title: 'Send to Orbit and Vane',
  description: 'List what is waiting to go to Orbit (engagers: public handle and post link) and Vane (annotations for posts), and send one. A send records what the seed answered.',
  scope: 'stump:stack', classes: ['standard', 'sensitive'], clauses: ['STUMP-STACK-002', 'STUMP-STACK-004', 'STUMP-SURFACE-015'],
  actions: {
    offers: {
      roles: EDITORS, read: true,
      properties: { state: { enum: ['offered', 'sent', 'failed', 'dismissed'] }, seed },
      // The list shows engagers' public handles and post links, so reading it computes sensitive with the number of people.
      async classify(args, ctx) {
        const { offers, people } = await countOffers(ctx.db, { state: args.state as string | undefined, seed: args.seed as string | undefined })
        return [...standard(offers), { class: 'sensitive' as const, facts: { measure: people, kind: 'public handles and post links' } }]
      },
      run: (args, ctx) => listOffers(ctx.db, { state: args.state as string | undefined, seed: args.seed as string | undefined }),
    },
    send: {
      roles: EDITORS,
      properties: { offer_id: { type: 'string', minLength: 1, maxLength: 64 } }, required: ['offer_id'],
      // Computed from the offer record, never from the arguments' text (D-7): an engager is one person's public handle and post link.
      async classify(args, ctx) {
        const offer = await readOffer(ctx.db, String(args.offer_id))
        if (!offer) refuse('not_found', { offer_id: String(args.offer_id) })
        return offer.kind === 'engager' ? [...standard(), { class: 'sensitive' as const, facts: { measure: 1, kind: 'public handles and post links' } }] : standard()
      },
      async summary(args, ctx) {
        const offer = await readOffer(ctx.db, String(args.offer_id))
        return { target: { name: offer?.kind === 'engager' ? `Send ${offer.handle} to Orbit` : `Send an annotation to Vane` } }
      },
      target: args => ({ kind: 'offer', id: String(args.offer_id) }),
      async run(args, ctx) {
        const id = String(args.offer_id), sent = await sendOffer(ctx.env, id, ctx.person.id, ctx.now())
        if (sent.status === 'not_connected') refuse('not_connected', { offer_id: id, seed: sent.seed, reason: `Connect ${sent.seed} first.` })
        if (sent.status === 'dismissed') refuse('conflict', { offer_id: id, state: 'dismissed' })
        if (sent.status === 'skipped') return { offer_id: id, state: sent.offer?.state ?? null, sent: false, reason: sent.reason }
        ctx.emit('stack.sent', `stump://stack/offers/${id}`, { seed: sent.offer.seed, state: sent.offer.state })
        const offer = publicOffer(sent.offer)
        return { offer_id: id, state: offer.state, sent: sent.offer.state === 'sent', already_sent: sent.status === 'already_sent', outcome: offer.outcome, offer }
      },
    },
  },
}]
