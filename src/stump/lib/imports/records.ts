// The seam to Base's import-kit. A parsed import becomes kit-shaped records
// (`kind`, `sourceId`, JSON `payload`: what the kit's `parse` returns) and each
// record maps to inert target effects (`targetKind`, `targetId`, `value`: what
// the kit's `ImportMapping.map` returns). Rejected rows travel as records too,
// so the kit reports them with their reasons.
import type { ImportEffect, ImportRow, JsonObject, ParsedImport, RejectedRow } from './types.ts';

/** The kit's record: what a reader emits for one source object. */
export interface ImportRecord { kind: string; sourceId: string; payload: JsonObject }

/** The kit's mapping result for one record. */
export interface MappedRecord { effects: ImportEffect[]; rejection?: string }

export const REJECTED_KIND = 'rejected';

/** Record kind to target kind. Venue-list drafts and Buffer posts are both items. */
export const TARGET_KINDS: Record<string, string> = {
  venue: 'venue', draft: 'item', channel: 'channel', slot: 'queue_slot', sent: 'ledger_entry', queued: 'item', buffer_draft: 'item',
};

function rejectedRecord(row: RejectedRow, index: number): ImportRecord {
  return {
    kind: REJECTED_KIND,
    sourceId: `rejected:${index}:${row.kind}:${row.id}`,
    payload: { rejected: true, id: row.id, row_kind: row.kind, line: row.line, reasons: row.reasons },
  };
}

/** Accepted rows in dependency order, then each rejected row. */
export function toRecords(parsed: Pick<ParsedImport<never, unknown>, 'rows' | 'rejected'>): ImportRecord[] {
  return [
    ...parsed.rows.map(row => ({ kind: row.kind, sourceId: row.sourceId, payload: row.payload })),
    ...parsed.rejected.map(rejectedRecord),
  ];
}

/** One record to its effects, or to its rejection. Deterministic and pure. */
export function mapRecord(record: ImportRecord): MappedRecord {
  if (record.kind === REJECTED_KIND) {
    const reasons = Array.isArray(record.payload.reasons) ? (record.payload.reasons as string[]) : [];
    return { effects: [], rejection: `${String(record.payload.row_kind)} ${String(record.payload.id)}: ${reasons.join('; ')}` };
  }
  const targetKind = Object.hasOwn(TARGET_KINDS, record.kind) ? TARGET_KINDS[record.kind]! : null;
  if (!targetKind) return { effects: [], rejection: `unknown record kind "${record.kind}"` };
  return { effects: [{ targetKind, targetId: record.sourceId, value: record.payload }] };
}

export const rowEffects = (row: ImportRow): ImportEffect[] => mapRecord(row).effects;

export function effectsOf(parsed: Pick<ParsedImport<never, unknown>, 'rows'>): ImportEffect[] {
  return parsed.rows.flatMap(rowEffects);
}

export const targetKey = (targetKind: string, targetId: string): string => `${targetKind}|${targetId}`;
