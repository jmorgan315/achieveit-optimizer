/**
 * Builds the payload for the `extract-column-hints` edge function from the
 * layout classification + the workbook preview already produced in
 * FileUploadStep. Pure function — no I/O.
 */

import {
  deriveHierarchyColumns,
  type LayoutClassificationSheet,
} from "./hierarchyColumns";

const MAX_SAMPLES_PER_COL = 8;

export interface WorkbookPreviewSheet {
  sheetName: string;
  rows: (string | number | null)[][];
}

export interface ColumnPreview {
  column_index: number;
  header: string | null;
  sample_values: string[];
}

export interface HintInputSheet {
  sheet_name: string;
  header_row_index: number | null;
  hierarchy_columns: number[];
  name_column_index: number | null;
  column_previews: ColumnPreview[];
}

export interface ExtractColumnHintsInput {
  sessionId: string;
  sheets: HintInputSheet[];
}

export interface LayoutClassificationResult {
  sheets?: LayoutClassificationSheet[];
}

const SKIP_PATTERNS = new Set(["not_plan_content", "empty", "unknown"]);

function cellToString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = typeof v === "string" ? v : String(v);
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function buildColumnHintInput(
  sessionId: string,
  layoutClassification: LayoutClassificationResult | null | undefined,
  workbookPreview: WorkbookPreviewSheet[],
): ExtractColumnHintsInput {
  const previewBySheet = new Map<string, WorkbookPreviewSheet>();
  for (const s of workbookPreview) previewBySheet.set(s.sheetName, s);

  const out: HintInputSheet[] = [];

  for (const layoutSheet of layoutClassification?.sheets ?? []) {
    if (layoutSheet.pattern && SKIP_PATTERNS.has(layoutSheet.pattern)) continue;

    const preview = previewBySheet.get(layoutSheet.sheet_name);
    if (!preview || !preview.rows?.length) continue;

    const { hierarchy_columns, name_column_index } =
      deriveHierarchyColumns(layoutSheet);
    const skip = new Set(hierarchy_columns);

    const headerIdx =
      typeof layoutSheet.structure?.header_row_index === "number"
        ? layoutSheet.structure!.header_row_index!
        : 0;
    const dataStart =
      typeof layoutSheet.structure?.data_starts_at_row === "number"
        ? layoutSheet.structure!.data_starts_at_row!
        : headerIdx + 1;

    const headerRow = preview.rows[headerIdx] ?? [];
    const maxCols = Math.max(
      headerRow.length,
      ...preview.rows.slice(dataStart).map((r) => r?.length ?? 0),
    );

    const column_previews: ColumnPreview[] = [];
    for (let col = 0; col < maxCols; col++) {
      if (skip.has(col)) continue;

      const header = cellToString(headerRow[col]);
      const samples: string[] = [];
      for (let r = dataStart; r < preview.rows.length; r++) {
        const v = cellToString(preview.rows[r]?.[col]);
        if (v !== null) {
          samples.push(v.length > 120 ? v.slice(0, 120) + "…" : v);
          if (samples.length >= MAX_SAMPLES_PER_COL) break;
        }
      }
      // Skip columns with no header AND no sample values — pure dead space.
      if (header === null && samples.length === 0) continue;

      column_previews.push({
        column_index: col,
        header,
        sample_values: samples,
      });
    }

    if (column_previews.length === 0) continue;

    out.push({
      sheet_name: layoutSheet.sheet_name,
      header_row_index: headerIdx,
      hierarchy_columns,
      name_column_index,
      column_previews,
    });
  }

  return { sessionId, sheets: out };
}
