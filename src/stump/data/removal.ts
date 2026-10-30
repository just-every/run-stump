// A post the erasure had deleted at its network (STUMP-DATA-002.3), kept on the
// ledger the way the ledger records every post that came down: state removed,
// with the removal's reason, who asked, when, and the network's answer under
// network_delete (the representation stump.ledger.correct mark_removed writes).
// The entry keeps its post; a legal hold keeps it as it is.

/** What the network answered the delete request: deleted, or already gone. */
export type NetworkDelete = 'deleted' | 'not_found'

export function erasureRemoval(db: D1Database, entryId: string, outcome: NetworkDelete, input: { erasure_id: string; person_id: string; agent_id: string | null; now: number }): D1PreparedStatement {
  const at = new Date(input.now).toISOString()
  const removal = { reason: `Erasure ${input.erasure_id}: a person it names asked to be erased`, person_id: input.person_id, agent_id: input.agent_id, at, network_delete: { outcome, at } }
  return db.prepare("UPDATE stump_ledger SET state='removed',removal=?,updated_at=? WHERE id=? AND state IN ('posted','uncertain') AND legal_hold IS NULL")
    .bind(JSON.stringify(removal), input.now, entryId)
}
