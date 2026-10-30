// Compares what an import would write with what already exists, so a rerun
// changes nothing and a changed row is named as a conflict that waits for a
// choice (STUMP-VENUE-004.4, STUMP-IMPORT-001.4).
import { canonicalJson } from './canonical.ts';
import { targetKey } from './records.ts';
import type { ExistingTargets, ImportEffect, Json, JsonObject } from './types.ts';

export type Change = 'create' | 'unchanged' | 'kept_edit' | 'conflict';
export type ConflictCause = 'source_changed' | 'both_changed' | 'differs';
export type Choice = 'keep' | 'take_import';

export interface FieldChange { field: string; current: Json; incoming: Json }

export interface Difference {
  targetKind: string;
  targetId: string;
  change: Change;
  /** Why a conflict arose, when the previous import's value is known. */
  cause?: ConflictCause;
  /** Fields whose current value differs from the incoming one. */
  fields: FieldChange[];
  /** For a conflict, the choice made; absent while it waits. */
  choice?: Choice;
}

const same = (a: Json | undefined, b: Json | undefined): boolean => canonicalJson(a ?? null) === canonicalJson(b ?? null);

function changedFields(incoming: JsonObject, other: JsonObject): FieldChange[] {
  const out: FieldChange[] = [];
  for (const field of Object.keys(incoming).sort()) {
    if (!same(incoming[field], other[field])) out.push({ field, current: other[field] ?? null, incoming: incoming[field] ?? null });
  }
  return out;
}

/**
 * Classify one effect against its existing target.
 *  - absent: create
 *  - equal on every field the import sets: unchanged
 *  - source unchanged since the last import but edited here: kept_edit (nothing to do, the edit stays)
 *  - otherwise: conflict, which waits for a choice
 */
export function classify(effect: ImportEffect, existing: ExistingTargets, choices: Record<string, Choice> = {}): Difference {
  const key = targetKey(effect.targetKind, effect.targetId);
  const found = existing[key];
  const base = { targetKind: effect.targetKind, targetId: effect.targetId };
  if (!found) return { ...base, change: 'create', fields: [] };
  const fields = changedFields(effect.value, found.current);
  if (fields.length === 0) return { ...base, change: 'unchanged', fields: [] };
  if (found.imported && changedFields(effect.value, found.imported).length === 0) return { ...base, change: 'kept_edit', fields };
  const cause: ConflictCause = found.imported ? (changedFields(found.imported, found.current).length === 0 ? 'source_changed' : 'both_changed') : 'differs';
  const choice = choices[key];
  return { ...base, change: 'conflict', cause, fields, ...(choice ? { choice } : {}) };
}

export function classifyAll(effects: ImportEffect[], existing: ExistingTargets, choices: Record<string, Choice> = {}): Difference[] {
  return effects.map(effect => classify(effect, existing, choices));
}
