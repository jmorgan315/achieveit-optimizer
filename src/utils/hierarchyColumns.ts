/**
 * Shared helper for deriving the set of "structural" column indices that
 * downstream attribute-role logic must SKIP (because they encode the
 * plan-item hierarchy / primary name, not free-form attributes).
 *
 * Single source of truth used by:
 *   - src/utils/columnHintInput.ts  (Stage A2 — column-hint extractor input)
 *   - Stage-B parser                 (future — same exclusion rule)
 *
 * Today the classifier output exposes `name_column_index` per sheet; a
 * future structural pass may add an explicit `hierarchy_columns` array.
 * This helper accepts both and unions them, so callers don't need to be
 * upgraded when that field appears.
 */

export interface LayoutClassificationSheetStructure {
  header_row_index?: number | null;
  data_starts_at_row?: number | null;
  name_column_index?: number | null;
  hierarchy_columns?: number[] | null;
  hierarchy_signal?: string | null;
  implied_levels?: string[];
  section_marker_pattern?: string | null;
}

export interface LayoutClassificationSheet {
  sheet_name: string;
  pattern?: string;
  structure?: LayoutClassificationSheetStructure | null;
}

export interface HierarchyColumnSpec {
  /** Sorted, deduped column indices to skip when sampling for attribute hints. */
  hierarchy_columns: number[];
  /** The single column that holds the primary item name, when known. */
  name_column_index: number | null;
}

export function deriveHierarchyColumns(
  layoutSheet: LayoutClassificationSheet | null | undefined,
): HierarchyColumnSpec {
  const s = layoutSheet?.structure ?? null;
  const name =
    typeof s?.name_column_index === "number" ? s!.name_column_index! : null;

  const set = new Set<number>();
  if (Array.isArray(s?.hierarchy_columns)) {
    for (const c of s!.hierarchy_columns!) {
      if (typeof c === "number" && Number.isFinite(c) && c >= 0) set.add(c);
    }
  }
  if (name !== null) set.add(name);

  return {
    hierarchy_columns: Array.from(set).sort((a, b) => a - b),
    name_column_index: name,
  };
}
