// A dry-run plan: what the import holds, what it would write against what
// already exists, what waits for a choice, and what was rejected. Planning
// writes nothing. The same input and the same existing state always produce the
// same plan and fingerprint.
import { canonicalJson, sha256Hex } from './canonical.ts';
import { classifyAll, type Choice, type Difference } from './diff.ts';
import { parseBufferBundle } from './buffer.ts';
import { parseOutreachMarkdown } from './outreach-md.ts';
import { effectsOf, targetKey } from './records.ts';
import { parseVenuesCsv } from './venues-csv.ts';
import type { ExistingTargets, ImportEffect, ImportLimits, ImportSource, ImportWarning, ParsedBuffer, ParsedImport, ParsedVenueList, RejectedRow } from './types.ts';

export interface PlanOptions {
  /** What already exists for the targets this import writes; empty means a first import. */
  existing?: ExistingTargets;
  /** The person's choice for each conflict, keyed by `targetKey(kind, id)`. */
  choices?: Record<string, Choice>;
  limits?: Partial<ImportLimits>;
}

export interface ChangeCounts { create: number; unchanged: number; kept_edit: number; conflict: number }

export interface ImportPlanResult<S> {
  source: ImportSource;
  /** venue list: venues, entries, excluded. Buffer: channels, sent, queued. */
  summary: S;
  rejected: RejectedRow[];
  warnings: ImportWarning[];
  /** Every record the source holds, as effects. */
  effects: ImportEffect[];
  /** The effects an apply would write now: new targets, plus conflicts resolved to take_import. */
  toWrite: ImportEffect[];
  changes: ChangeCounts;
  /** Changed targets: conflicts (waiting, or with their choice) and kept native edits. Empty on a rerun. */
  differences: Difference[];
  /** Conflicts still waiting for a choice. */
  conflicts: Difference[];
  /** Nothing to write and nothing waiting: the rerun case. */
  noop: boolean;
  fingerprint: string;
}

export function planParsed<S extends ImportSource, Sum>(parsed: ParsedImport<S, Sum>, options: PlanOptions = {}): ImportPlanResult<Sum> {
  const existing = options.existing ?? {};
  const choices = options.choices ?? {};
  const effects = effectsOf(parsed);
  const classified = classifyAll(effects, existing, choices);
  const toWrite = effects.filter((_effect, i) => {
    const d = classified[i]!;
    return d.change === 'create' || (d.change === 'conflict' && d.choice === 'take_import');
  });
  const conflicts = classified.filter(d => d.change === 'conflict' && !d.choice);
  const changes: ChangeCounts = { create: 0, unchanged: 0, kept_edit: 0, conflict: 0 };
  for (const d of classified) changes[d.change]++;
  const differences = classified.filter(d => d.change === 'conflict' || d.change === 'kept_edit');
  const fingerprint = sha256Hex(canonicalJson({
    source: parsed.source,
    effects: effects.map(e => ({ k: e.targetKind, i: e.targetId, v: e.value })),
    rejected: parsed.rejected.map(r => [r.kind, r.id, r.reason]),
    classified: classified.map(d => [d.targetKind, d.targetId, d.change, d.choice ?? null]),
  }));
  return {
    source: parsed.source, summary: parsed.summary, rejected: parsed.rejected, warnings: parsed.warnings,
    effects, toWrite, changes, differences, conflicts, noop: toWrite.length === 0 && conflicts.length === 0, fingerprint,
  };
}

/** Plan a venue list read from the Markdown outreach format or a CSV. */
export function planVenueList(source: 'outreach-md' | 'venues-csv', text: string, options: PlanOptions = {}): ImportPlanResult<ParsedVenueList['summary']> {
  const parsed = source === 'outreach-md' ? parseOutreachMarkdown(text, options.limits) : parseVenuesCsv(text, options.limits);
  return planParsed(parsed, options);
}

/** Plan a Buffer export: the JSON text, or the already parsed bundle. */
export function planBuffer(input: unknown, options: PlanOptions = {}): ImportPlanResult<ParsedBuffer['summary']> {
  return planParsed(parseBufferBundle(input, options.limits), options);
}

export { targetKey };
