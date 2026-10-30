// The ledger entry for a post Buffer published (STUMP-IMPORT-001.2). The data
// contract makes src/stump/ledger/record.ts the one writer of stump_ledger; its
// writer on this base takes publish outcomes only, so this is the imported
// entry's write in the shape that writer takes (route published, confirmation
// network, the read-back url and text), to move into record.ts with it. The
// import kit commits it in its own batch, so it is plain SQL with parameters,
// and it keeps the import's stable id so a rerun replaces the same entry and
// Undo removes it.

/** A post another tool published, as its export recorded it: the network's address, text and results. */
export interface ImportedPost {
  network: string; account_id: string; url: string | null; network_id: string | null; text: string; posted_at: number
  /** Who published it, as the ledger shows it: the tool, since Stump cannot know which person pressed send there. */
  by: string
  results: { source: string; values: Record<string, number>; read_at: number | null } | null
}

/** The statement that writes one imported post as a published, network-confirmed entry; a replacement keeps the id and takes the file's values. */
export function importedEntrySql(id: string, post: ImportedPost, now: number): Array<{ sql: string; params: unknown[] }> {
  return [{
    sql: `INSERT INTO stump_ledger(id,item_id,url,network,network_id,account_id,person_id,agent,by_label,text,claims,route,state,confirmation,posted_at,results,created_at,updated_at)
      VALUES(?,NULL,?,?,?,?,NULL,NULL,?,?,'[]','published','posted','network',?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET url=excluded.url,network=excluded.network,network_id=excluded.network_id,account_id=excluded.account_id,by_label=excluded.by_label,
        text=excluded.text,posted_at=excluded.posted_at,results=excluded.results,updated_at=excluded.updated_at`,
    params: [id, post.url, post.network, post.network_id, post.account_id, post.by, post.text, post.posted_at, post.results ? JSON.stringify(post.results) : null, now, now],
  }]
}

/** Removes an imported entry the import still holds, with any version rows; `held` is the import's own guard fragment. */
export function removeImportedEntrySql(id: string, held: { sql: string; params: unknown[] }): Array<{ sql: string; params: unknown[] }> {
  return [
    { sql: `DELETE FROM stump_ledger_versions WHERE entry_id=? AND ${held.sql}`, params: [id, ...held.params] },
    { sql: `DELETE FROM stump_ledger WHERE id=? AND ${held.sql}`, params: [id, ...held.params] },
  ]
}
