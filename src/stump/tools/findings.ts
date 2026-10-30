import { refuse } from '../actions/refusals.ts'
import type { StumpTool } from '../actions/types.ts'
import { EDITORS, READERS } from '../people/roles.ts'
import { rankedFindings } from '../watches/findings.ts'
import { schemas } from '../watches/model.ts'
import { readWatch } from '../watches/store.ts'

interface FindingRow { id: string; watch_id: string; title: string | null; url: string; state: string }
const findingOf = (db: D1Database, id: string) => db.prepare('SELECT id,watch_id,title,url,state FROM stump_findings WHERE id=?').bind(id).first<FindingRow>()

export const findingsTools: StumpTool[] = [{
  name: 'stump.findings.work', title: 'Work the findings',
  description: 'List a watch\'s findings, best first, each with its reasons, the routes its venue\'s rules allow, and the products and competitors it names; dismiss one that is not worth answering. A finding\'s own text never changes its rank, a rule or a route.',
  scope: 'stump:findings', classes: ['standard'], clauses: ['STUMP-WATCH-001', 'STUMP-WATCH-005'],
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
    // A dismissed finding leaves the list and keeps its row, so the same thread never returns as new (STUMP-WATCH-001.3).
    dismiss: {
      roles: EDITORS,
      properties: { finding_id: schemas.finding_id }, required: ['finding_id'],
      classify: () => [{ class: 'standard', facts: { measure: 1 } }],
      target: args => ({ kind: 'finding', id: String(args.finding_id) }),
      async summary(args, ctx) { const row = await findingOf(ctx.db, String(args.finding_id)); return { target: { id: String(args.finding_id), name: row?.title || row?.url || String(args.finding_id) } } },
      async run(args, ctx) {
        const row = await findingOf(ctx.db, String(args.finding_id))
        if (!row) refuse('not_found', { finding_id: String(args.finding_id) })
        if (row.state !== 'dismissed') {
          await ctx.db.prepare("UPDATE stump_findings SET state='dismissed',dismissed_at=?,dismissed_by=? WHERE id=?").bind(ctx.now(), ctx.person.id, row.id).run()
          ctx.emit('finding.dismissed', `stump://watches/${row.watch_id}/findings/${row.id}`)
        }
        return { id: row.id, watch_id: row.watch_id, state: 'dismissed' }
      },
    },
  },
}]
