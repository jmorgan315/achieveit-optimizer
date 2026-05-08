// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

// Mock the diagnostics logger before importing the parser so the borderline
// surveillance row can be asserted without hitting the network.
vi.mock('@/utils/parserDiagnostics', () => ({
  logParserDiagnostic: vi.fn().mockResolvedValue(undefined),
}));

import {
  detectStructure,
  isStrategyMarker,
  type ClassifierStructureHint,
  type ParsedSheet,
} from './spreadsheet-parser';
import { logParserDiagnostic } from './parserDiagnostics';

import asteraCls from './__fixtures__/ssphase4c1/astera.classification.json';
import carmenCls from './__fixtures__/ssphase4c1/carmen.classification.json';

// ─── Fixture builders ───────────────────────────────────────────
// Synthetic rows that mirror the *shape* of the real files. The classifier
// JSONs above are real DB rows; the row arrays mirror header_row_index /
// data_starts_at_row / section_marker_pattern from those classifications.

function asteraSheetRows(): ParsedSheet {
  // Mirrors "Enterprise - All Pillars": header_row_index=3, data_starts_at_row=4
  return {
    name: 'Enterprise - All Pillars',
    rows: [
      ['Astera Health'],
      ['Operational Plan FY26'],
      [],
      ['Action', 'Owner', 'Due Date', 'Measurement'],
      ['Strategy: Patient Experience'],
      ['Outcomes', 'Improve HCAHPS scores'],
      ['Action', 'Owner', 'Due Date', 'Measurement'],
      ['Roll out new rounding tool', 'J. Smith', '2026-06-30', 'HCAHPS +5'],
      ['Train all nursing staff', 'K. Lee', '2026-09-30', '100% completion'],
      ['Strategy: Operational Excellence'],
      ['Outcomes', 'Reduce LOS by 0.5 days'],
      ['Action', 'Owner', 'Due Date', 'Measurement'],
      ['Implement discharge huddles', 'M. Patel', '2026-08-31', 'LOS -0.5'],
    ],
    columnCount: 4,
    rowCount: 13,
  };
}

function carmenSheetRows(): ParsedSheet {
  // Mirrors Carmen Sheet1 (Pattern C): header_row_index=0, data_starts_at_row=1
  return {
    name: 'Sheet1',
    rows: [
      ['CSF #', 'CBF', 'Program', 'EUM Element', 'TI Name', 'Milestone'],
      ['1', 'Finance', 'Modernization', 'EU-101', 'Cloud GL Migration', 'Vendor selection'],
      ['1', 'Finance', 'Modernization', 'EU-101', 'Cloud GL Migration', 'Pilot rollout'],
      ['2', 'Operations', 'Efficiency', 'EU-202', 'WMS Upgrade', 'RFP'],
    ],
    columnCount: 6,
    rowCount: 4,
  };
}

const asteraHint = (asteraCls as { sheets: Array<{ sheet_name: string; pattern: string; structure: Record<string, unknown> }> }).sheets
  .find(s => s.sheet_name === 'Enterprise - All Pillars')!;
const carmenHint = (carmenCls as { sheets: Array<{ sheet_name: string; pattern: string; structure: Record<string, unknown> }> }).sheets[0];

function hintFor(s: { pattern: string; structure: Record<string, unknown> }): ClassifierStructureHint {
  return {
    pattern: s.pattern,
    header_row_index: s.structure.header_row_index as number | null,
    data_starts_at_row: s.structure.data_starts_at_row as number | null,
    section_marker_pattern: (s.structure.section_marker_pattern as string | null) ?? null,
    implied_levels: s.structure.implied_levels as string[] | undefined,
  };
}

describe('detectStructure dispatch (Phase 4c.1)', () => {
  describe('heuristic dispatch (no hint)', () => {
    it('routes Strategy: rows to detectStrategyPattern', () => {
      const det = detectStructure([asteraSheetRows()]);
      expect(det.sheets[0].hasStrategyPattern).toBe(true);
      // 2 strategy sections in our fixture
      expect(det.sheets[0].sections.length).toBe(2);
    });

    it('routes non-strategy sheets to detectGenericPattern', () => {
      const det = detectStructure([carmenSheetRows()]);
      expect(det.sheets[0].hasStrategyPattern).toBe(false);
      // Generic fallback puts everything under one section
      expect(det.sheets[0].sections.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('classifier dispatch (real DB fixtures)', () => {
    it('routes Pattern A + ^Strategy: marker → strategy parser', () => {
      const sheet = asteraSheetRows();
      const hints = { [sheet.name]: hintFor(asteraHint) };
      const det = detectStructure([sheet], hints, 'test-session');
      expect(det.sheets[0].hasStrategyPattern).toBe(true);
      expect(det.sheets[0].sections.length).toBe(2);

      // Parity vs heuristic path — zero-delta contract.
      const heuristic = detectStructure([sheet]);
      expect(det.sheets[0].totalDataRows).toBe(heuristic.sheets[0].totalDataRows);
    });

    it('routes Pattern A + null marker → detectGenericFromClassifier (single region)', () => {
      const sheet: ParsedSheet = {
        name: 'Flat',
        rows: [
          ['Action', 'Owner', 'Due Date'],
          ['Item 1', 'A', '2026-01-01'],
          ['Item 2', 'B', '2026-02-01'],
          ['Item 3', 'C', '2026-03-01'],
        ],
        columnCount: 3,
        rowCount: 4,
      };
      const hints: Record<string, ClassifierStructureHint> = {
        Flat: {
          pattern: 'A',
          header_row_index: 0,
          data_starts_at_row: 1,
          section_marker_pattern: null,
        },
      };
      const det = detectStructure([sheet], hints);
      expect(det.sheets[0].hasStrategyPattern).toBe(false);
      expect(det.sheets[0].sections.length).toBe(1);
      expect(det.sheets[0].totalDataRows).toBe(3);
    });

    it('routes Pattern A + non-strategy marker → detectGenericFromClassifier (multi-section)', () => {
      const sheet: ParsedSheet = {
        name: 'Goals',
        rows: [
          ['Item', 'Owner'],
          ['Goal: Growth'],
          ['Expand product line', 'X'],
          ['Open new market', 'Y'],
          ['Goal: Quality'],
          ['Reduce defects', 'Z'],
        ],
        columnCount: 2,
        rowCount: 6,
      };
      const hints: Record<string, ClassifierStructureHint> = {
        Goals: {
          pattern: 'A',
          header_row_index: 0,
          data_starts_at_row: 1,
          section_marker_pattern: '^Goal:',
        },
      };
      const det = detectStructure([sheet], hints);
      expect(det.sheets[0].sections.length).toBe(2);
      expect(det.sheets[0].sections[0].headerText).toBe('Goal: Growth');
      expect(det.sheets[0].sections[1].headerText).toBe('Goal: Quality');
      expect(det.sheets[0].totalDataRows).toBe(3);
    });
  });

  describe('fallback paths', () => {
    it('falls back to heuristic when pattern is not A', () => {
      const sheet = carmenSheetRows();
      const hints = { [sheet.name]: hintFor(carmenHint) }; // pattern: 'C'
      const det = detectStructure([sheet], hints);
      const heuristic = detectStructure([sheet]);
      expect(det.sheets[0].totalDataRows).toBe(heuristic.sheets[0].totalDataRows);
    });

    it('falls back to heuristic when header_row_index is null', () => {
      const sheet = asteraSheetRows();
      const hints: Record<string, ClassifierStructureHint> = {
        [sheet.name]: { pattern: 'A', header_row_index: null, data_starts_at_row: 4, section_marker_pattern: '^Strategy:' },
      };
      const det = detectStructure([sheet], hints);
      const heuristic = detectStructure([sheet]);
      expect(det.sheets[0].totalDataRows).toBe(heuristic.sheets[0].totalDataRows);
    });
  });

  describe('isStrategyMarker', () => {
    it('confirms ^Strategy: marker on real-shape rows', () => {
      const sheet = asteraSheetRows();
      expect(isStrategyMarker(sheet.rows, hintFor(asteraHint))).toBe(true);
    });

    it('returns false for null marker', () => {
      expect(isStrategyMarker(carmenSheetRows().rows, hintFor(carmenHint))).toBe(false);
    });

    it('returns false for non-matching marker (no marker rows)', () => {
      const hint: ClassifierStructureHint = {
        pattern: 'A', header_row_index: 0, data_starts_at_row: 1, section_marker_pattern: '^Goal:',
      };
      expect(isStrategyMarker(asteraSheetRows().rows, hint)).toBe(false);
    });

    it('handles malformed regex without throwing', () => {
      const hint: ClassifierStructureHint = {
        pattern: 'A', header_row_index: 0, data_starts_at_row: 0, section_marker_pattern: '[invalid(',
      };
      expect(isStrategyMarker(asteraSheetRows().rows, hint)).toBe(false);
    });

    it('fires borderline diagnostic when 0% < agreement < 80%', () => {
      vi.mocked(logParserDiagnostic).mockClear();
      // Construct rows where ^Item: marks 5 rows but only 1 also matches isStrategyRow.
      const rows: (string | number | null)[][] = [
        ['Item: A'], ['Strategy: real one'], ['Item: B'], ['Item: C'], ['Item: D'],
      ];
      // Marker matches all 5; isStrategyRow matches only "Strategy: real one" → 1/5 = 20%.
      // But our marker is ^Item: which won't match the strategy row. Use a broader marker.
      const rows2: (string | number | null)[][] = [
        ['Strategy: A'], ['Heading: B'], ['Heading: C'], ['Heading: D'], ['Heading: E'],
      ];
      // marker "^(Strategy|Heading):" matches all 5; isStrategyRow matches 1 → 20%.
      const hint: ClassifierStructureHint = {
        pattern: 'A', header_row_index: 0, data_starts_at_row: 0, section_marker_pattern: '^(Strategy|Heading):',
      };
      const result = isStrategyMarker(rows2, hint, 'sess-x', 'SheetX');
      expect(result).toBe(false);
      expect(logParserDiagnostic).toHaveBeenCalledWith(
        'sess-x', 'ssphase4c1', 'strategy-marker-borderline',
        expect.objectContaining({ agreementRatio: 0.2, markerRowCount: 5, strategyRowCount: 1 }),
        'SheetX',
      );
      // silence unused var warning
      void rows;
    });
  });
});
