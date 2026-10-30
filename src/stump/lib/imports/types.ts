// Shared shapes for the import parsers and planners. No imports from outside
// this folder: these types are structurally compatible with Base's import-kit
// (ParsedRecord, TargetEffect, MappingResult in modules/import-kit/src/types.ts),
// and the spine passes them across that boundary.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export type ImportSource = 'outreach-md' | 'venues-csv' | 'buffer';

/** A normalized source row, ready to become one or more effects. */
export interface ImportRow {
  kind: string;
  /** Stable and unique within one import; equal to the primary target id. */
  sourceId: string;
  payload: JsonObject;
  /** One-based source line (Markdown, CSV) when known. */
  line?: number;
}

/** What the import would write: one target record. Kit-compatible. */
export interface ImportEffect {
  targetKind: string;
  targetId: string;
  value: JsonObject;
}

export interface RejectedRow {
  /** The row's own id (entry id, venue id, profile or update id, or a name). */
  id: string;
  kind: string;
  line: number | null;
  /** All reasons joined with "; ". */
  reason: string;
  reasons: string[];
}

export interface ImportWarning {
  code: string;
  message: string;
  id?: string;
}

export interface ParsedImport<S extends ImportSource, Summary> {
  source: S;
  /** Accepted rows in dependency order (parents before children). */
  rows: ImportRow[];
  rejected: RejectedRow[];
  warnings: ImportWarning[];
  summary: Summary;
}

export interface VenueListSummary { venues: number; entries: number; excluded: number }
export interface BufferSummary { channels: number; sent: number; queued: number }

export type ParsedVenueList = ParsedImport<'outreach-md' | 'venues-csv', VenueListSummary>;
export type ParsedBuffer = ParsedImport<'buffer', BufferSummary>;

export interface ImportLimits {
  /** Largest input text accepted, in UTF-16 code units. */
  maxChars: number;
  /** Most source rows (entries, venues, exclusions, CSV rows, posts) accepted. */
  maxRows: number;
}

export const DEFAULT_LIMITS: ImportLimits = { maxChars: 12_000_000, maxRows: 100_000 };

export type ImportInputErrorCode =
  | 'input_too_large'
  | 'too_many_rows'
  | 'not_text'
  | 'bad_json'
  | 'bad_format'
  | 'csv_unterminated_quote'
  | 'csv_missing_column'
  | 'not_venue_list';

/** The whole input is unusable (as opposed to one row, which is rejected by name). */
export class ImportInputError extends Error {
  readonly code: ImportInputErrorCode;
  constructor(code: ImportInputErrorCode, message: string) {
    super(message);
    this.name = 'ImportInputError';
    this.code = code;
  }
}

/** The current state of one target the import already wrote or could collide with. */
export interface ExistingTarget {
  /** The target's current import-owned fields. Only keys the import sets are compared. */
  current: JsonObject;
  /** The value the last import wrote, when known; tells a native edit from a source change. */
  imported?: JsonObject;
}
export type ExistingTargets = Record<string, ExistingTarget>;
