# lib/imports

Pure parsers and planners for the import door's three sources. No network, no storage, no imports from outside this folder.

| Source | Input | Clauses |
| --- | --- | --- |
| `outreach-md` | the 19 Oct 2026 venue-list Markdown | STUMP-VENUE-004 |
| `venues-csv` | a CSV whose header names the same keys | STUMP-VENUE-004 |
| `buffer` | a JSON bundle of Buffer's v1 API objects | STUMP-IMPORT-001 |

## Flow

`parseOutreachMarkdown(text)`, `parseVenuesCsv(text)` or `parseBufferBundle(textOrObject)` return `{ rows, rejected, warnings, summary }`.
`summary` is `{ venues, entries, excluded }` for a venue list and `{ channels, sent, queued }` for Buffer.
`rejected[]` names each refused row (`id`, `kind`, `line`, `reason`, `reasons[]`). A whole unusable input throws `ImportInputError` with a `code`.

`planVenueList(source, text, options)` and `planBuffer(input, options)` add the dry-run view: every effect, what an apply would write now
(`toWrite`), `changes` counts, `differences`, `conflicts` waiting for a choice, `noop`, and a deterministic `fingerprint`.
Pass `options.existing` (what the targets hold now, plus the value the last import wrote) so a rerun is a no-op and a changed row is a named conflict;
pass `options.choices` (`keep` or `take_import`, keyed by `targetKey(kind, id)`) to settle conflicts.

## Base import-kit seam

`toRecords(parsed)` gives `{ kind, sourceId, payload }` records (accepted rows in dependency order, then rejected rows as kind `rejected`).
`mapRecord(record)` is an `ImportMapping.map`: it returns `{ effects: [{ targetKind, targetId, value }] }` or `{ rejection }`.

| Record kind | Target kind | Target id |
| --- | --- | --- |
| `venue` | `venue` | `venue:<normalized url>` (or `venue:name:<folded name>` when an exclusion has no URL) |
| `draft` (venue list) | `item` | `outreach-entry:<entry id>` |
| `channel` | `channel` | `buffer-channel:<profile id>` |
| `slot` | `queue_slot` | `buffer-slot:<profile id>:<day>:<HH:MM>` |
| `sent` | `ledger_entry` | `buffer-sent:<update id>` |
| `queued` | `item` (state `paused`, with a `hold`) | `buffer-queued:<update id>` |
| `buffer_draft` | `item` (state `draft`) | `buffer-draft:<update id>` |

Values hold product names (`products[{name}]`, `product_name`) and channel references (`channel_key`, `venue_key`, the target id of the parent), which the target adapter resolves to Stump ids.
