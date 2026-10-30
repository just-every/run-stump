// Parsers and planners for the import door's three sources.
//   outreach-md  the 19 Oct 2026 venue-list Markdown      STUMP-VENUE-004
//   venues-csv   a CSV whose header names the same keys   STUMP-VENUE-004
//   buffer       a bundle of Buffer's v1 API objects      STUMP-IMPORT-001
// Pure: no network, no storage. Rows are normalized and every refused row is
// named with its reasons.
export type {
  ExistingTarget, ExistingTargets, ImportEffect, ImportInputErrorCode, ImportLimits, ImportRow, ImportSource, ImportWarning,
  Json, JsonObject, ParsedBuffer, ParsedImport, ParsedVenueList, RejectedRow, VenueListSummary, BufferSummary,
} from './types.ts';
export { DEFAULT_LIMITS, ImportInputError } from './types.ts';

export { parseOutreachMarkdown } from './outreach-md.ts';
export { parseVenuesCsv } from './venues-csv.ts';
export { parseCsv } from './csv.ts';
export type { CsvTable } from './csv.ts';
export {
  BUFFER_BUNDLE_FORMAT, BUFFER_NETWORKS, parseBufferBundle, unixToIso,
  channelTargetId, slotTargetId, sentTargetId, queuedTargetId, draftTargetId,
} from './buffer.ts';

export { toRecords, mapRecord, effectsOf, rowEffects, targetKey, TARGET_KINDS, REJECTED_KIND } from './records.ts';
export type { ImportRecord, MappedRecord } from './records.ts';

export { classify, classifyAll } from './diff.ts';
export type { Change, Choice, ConflictCause, Difference, FieldChange } from './diff.ts';

export { planParsed, planVenueList, planBuffer } from './plan.ts';
export type { ChangeCounts, ImportPlanResult, PlanOptions } from './plan.ts';

export { canonicalJson, sha256Hex } from './canonical.ts';
export { normalizeVenueUrl, isHttpUrl, foldName } from './url.ts';
export { inferKind, parseSharedLimit, VENUE_KINDS, VENUE_STATUSES } from './venue-fields.ts';
export type { VenueKind, VenueStatus } from './venue-fields.ts';
export { venueKey, venueTargetId, draftTargetId as venueDraftTargetId } from './venue-assemble.ts';
