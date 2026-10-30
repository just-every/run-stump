import { refuse } from '../actions/refusals.ts'
import type { StumpTool } from '../actions/types.ts'
import { READERS } from '../people/roles.ts'
import { rankedFindings } from '../watches/findings.ts'
import { schemas } from '../watches/model.ts'
import { readWatch } from '../watches/store.ts'

export const findingsTools: StumpTool[] = [{
  name: 'stump.findings.work', title: 'Work the findings',
  description: 'List a watch\'s findings, best first, each with its reasons, the routes its venue\'s rules allow, and the products and competitors it names. A finding\'s own text never changes its rank, a rule or a route.',
  scope: 'stump:findings', classes: ['standard'], clauses: ['STUMP-WATCH-005'],
  actions: {
    list: {
      roles: READERS, read: true,
      properties: { watch_id: schemas.watch_id, limit: { type: 'integer', minimum: 1, maximum: 200 } }, required: ['watch_id'],
      classify: () => [{ class: 'standard', facts: { measure: 0 } }],
      target: args => ({ kind: 'watch', id: String(args.watch_id) }),
      async run(args, ctx) {
        const watch = await readWatch(ctx.db, String(args.watch_id))
        if (!watch) refuse('not_found', { watch_id: String(args.watch_id) })
        const { items, total } = await rankedFindings(ctx.db, watch, ctx.now(), (args.limit as number | undefined) ?? 100)
        return { watch: { id: watch.id, name: watch.name }, items, total }
      },
    },
  },
}]
