import { refuse } from '../actions/refusals.ts'
import type { StumpTool } from '../actions/types.ts'
import { checkRules, readRules, tagOwnLinksDetailed, writeRules } from '../links/index.ts'
import { ADMINS, EVERYONE } from '../people/roles.ts'

const medium = { enum: ['social', 'community', 'referral', 'email', 'press'] }
const standard = (measure = 1) => [{ class: 'standard' as const, facts: { measure } }]
const view = (rules: Awaited<ReturnType<typeof readRules>>) => rules ?? { own_domains: [], mediums: null, revision: 0, updated_by: null, updated_at: null }

export const linksTools: StumpTool[] = [{
  name: 'stump.links.manage', title: 'Tag links',
  description: 'Set the company\'s own domains and the utm_medium of each route once; Stump then tags links to those domains only. Preview shows how a text will read.',
  scope: 'stump:links', classes: ['standard'], clauses: ['STUMP-LINK-001'],
  actions: {
    set_rules: {
      roles: ADMINS,
      properties: {
        own_domains: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 253 } },
        mediums: { type: 'object', properties: { published: medium, handoff: medium }, required: ['published', 'handoff'], additionalProperties: false },
      },
      required: ['own_domains', 'mediums'],
      classify: () => standard(),
      summary: () => ({ target: { name: 'Set the link tagging rules' } }),
      target: () => ({ kind: 'link-rules', id: 'rules' }),
      async run(args, ctx) {
        const { rules, errors } = checkRules({ own_domains: args.own_domains as string[], mediums: args.mediums as { published: string; handoff: string } })
        if (errors.length) refuse('invalid_arguments', { field: 'own_domains', errors })
        await writeRules(ctx.db, rules, ctx.person.id, ctx.now())
        ctx.emit('links.rules_set', 'stump://links/rules', { own_domains: rules.own_domains })
        return view(await readRules(ctx.db))
      },
    },
    rules: {
      roles: EVERYONE, read: true,
      classify: () => standard(),
      async run(_args, ctx) { return view(await readRules(ctx.db)) },
    },
    preview: {
      roles: EVERYONE, read: true,
      properties: {
        text: { type: 'string', minLength: 1, maxLength: 20000 }, route: { enum: ['published', 'handoff'] },
        source: { type: 'string', minLength: 1, maxLength: 120 }, campaign: { type: 'string', minLength: 1, maxLength: 120 }, content: { type: 'string', minLength: 1, maxLength: 120 },
      },
      required: ['text', 'route', 'source', 'content'],
      classify: () => standard(),
      async run(args, ctx) {
        const result = await tagOwnLinksDetailed(ctx.db, { text: String(args.text), route: args.route as 'published' | 'handoff', source: String(args.source),
          campaign: typeof args.campaign === 'string' ? args.campaign : null, content: String(args.content) })
        return { text: result.text, links: result.links, rules_set: result.rules_set }
      },
    },
  },
}]
