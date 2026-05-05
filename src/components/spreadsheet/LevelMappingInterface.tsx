/**
 * Phase 4d.2.a — Column-to-Level mapping UI for Pattern B/C "Let me adjust".
 *
 * No filename / sheet-name / column-header heuristics. Every column option,
 * level row, and fill-ratio number is derived from the runtime ParsedSheet
 * + classifier output that's already loaded.
 */

import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CheckCircle2, AlertTriangle, ArrowLeft, Sparkles } from 'lucide-react';
import { ParsedSheet } from '@/utils/spreadsheet-parser';
import {
  parseHierarchicalColumns,
  SheetClassification,
  CellTransformation,
} from '@/utils/parsers/parseHierarchicalColumns';

interface LevelMappingInterfaceProps {
  sheetName: string;
  parsedSheet: ParsedSheet;
  classification: SheetClassification;
  initialLevels: string[];
  initialColumnIndices: number[];
  /** Active cell transformations carried forward into the re-parse. */
  cellTransformations?: CellTransformation[];
  sessionId: string;
  onApply: (userLevels: string[], userLevelColumnIndices: number[]) => void;
  onCancel: () => void;
}

function colLetter(index: number): string {
  let n = index;
  let out = '';
  while (n >= 0) {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  }
  return out;
}

export function LevelMappingInterface({
  sheetName,
  parsedSheet,
  classification,
  initialLevels,
  initialColumnIndices,
  cellTransformations,
  sessionId,
  onApply,
  onCancel,
}: LevelMappingInterfaceProps) {
  const headerRowIdx = classification.structure?.header_row_index ?? 0;
  const dataStartRow = classification.structure?.data_starts_at_row ?? headerRowIdx + 1;

  const headerRow = useMemo<string[]>(() => {
    const row = parsedSheet.rows?.[headerRowIdx];
    if (!Array.isArray(row)) return [];
    return row.map(c => (c == null ? '' : String(c).trim()));
  }, [parsedSheet, headerRowIdx]);

  const totalColumns = Math.max(parsedSheet.columnCount ?? 0, headerRow.length);

  // Per-column fill ratio across data rows (skipping fully empty rows).
  const fillRatios = useMemo<number[]>(() => {
    const counts = new Array(totalColumns).fill(0);
    let total = 0;
    for (let r = dataStartRow; r < parsedSheet.rows.length; r++) {
      const row = parsedSheet.rows[r];
      if (!Array.isArray(row)) continue;
      const anyFilled = row.some(c => c != null && String(c).trim() !== '');
      if (!anyFilled) continue;
      total++;
      for (let i = 0; i < totalColumns; i++) {
        const v = row[i];
        if (v != null && String(v).trim() !== '') counts[i]++;
      }
    }
    return counts.map(n => (total > 0 ? n / total : 0));
  }, [parsedSheet, dataStartRow, totalColumns]);

  const [levelIndices, setLevelIndices] = useState<number[]>(() => {
    const out = initialLevels.map((_, i) => initialColumnIndices[i] ?? i);
    return out;
  });

  const usedTwice = useMemo(() => {
    const seen = new Map<number, number[]>();
    levelIndices.forEach((idx, i) => {
      if (idx < 0) return;
      if (!seen.has(idx)) seen.set(idx, []);
      seen.get(idx)!.push(i);
    });
    return Array.from(seen.entries()).filter(([, list]) => list.length > 1);
  }, [levelIndices]);

  const lowFillLevelWarnings = useMemo(() => {
    return levelIndices
      .map((idx, i) => ({ levelIdx: i, idx, ratio: idx >= 0 ? fillRatios[idx] : 0 }))
      .filter(r => r.idx >= 0 && r.ratio === 0);
  }, [levelIndices, fillRatios]);

  // Live preview parse against current selection.
  const preview = useMemo(() => {
    try {
      const result = parseHierarchicalColumns(
        parsedSheet,
        classification,
        initialLevels,
        null, // don't log live preview re-parses
        levelIndices,
        cellTransformations,
      );
      return { items: result.items.slice(0, 10), total: result.items.length };
    } catch {
      return { items: [], total: 0 };
    }
  }, [parsedSheet, classification, initialLevels, levelIndices, cellTransformations]);

  const canApply = usedTwice.length === 0;

  const columnOptions = useMemo(() => {
    const opts: Array<{ value: string; label: string }> = [];
    for (let i = 0; i < totalColumns; i++) {
      const header = headerRow[i] || '(no header)';
      const pct = Math.round((fillRatios[i] || 0) * 100);
      opts.push({
        value: String(i),
        label: `${header} — Column ${colLetter(i)} (idx ${i}) — ${pct}% filled`,
      });
    }
    return opts;
  }, [headerRow, fillRatios, totalColumns]);

  return (
    <div className="w-full max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 flex-wrap">
              <Sparkles className="h-4 w-4 text-primary" />
              Map levels to columns
              <Badge variant="outline" className="font-normal">{sheetName}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {initialLevels.map((levelName, i) => (
              <div key={`${levelName}-${i}`} className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium min-w-[160px]">
                  Level {i + 1}: <span className="text-foreground">{levelName}</span>
                </div>
                <Select
                  value={String(levelIndices[i] ?? -1)}
                  onValueChange={(v) => {
                    const next = levelIndices.slice();
                    next[i] = parseInt(v, 10);
                    setLevelIndices(next);
                  }}
                >
                  <SelectTrigger className="flex-1 min-w-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {columnOptions.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </CardContent>
        </Card>

        {usedTwice.length > 0 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Two levels share the same column</AlertTitle>
            <AlertDescription>
              {usedTwice.map(([col, list]) => (
                <div key={col}>
                  Column {colLetter(col)} is used by:{' '}
                  {list.map(i => `Level ${i + 1} (${initialLevels[i]})`).join(', ')}
                </div>
              ))}
            </AlertDescription>
          </Alert>
        )}

        {lowFillLevelWarnings.length > 0 && (
          <Alert className="border-amber-500/50 bg-amber-500/5">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertTitle>Some levels mapped to empty columns</AlertTitle>
            <AlertDescription>
              {lowFillLevelWarnings.map(w => (
                <div key={w.levelIdx}>
                  Level {w.levelIdx + 1} ({initialLevels[w.levelIdx]}) → Column {colLetter(w.idx)} has 0% data
                </div>
              ))}
            </AlertDescription>
          </Alert>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onCancel}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Confirmation
          </Button>
          <Button
            onClick={() => onApply(initialLevels, levelIndices)}
            disabled={!canApply}
          >
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Apply Mapping
          </Button>
        </div>
      </div>

      <Card className="h-fit">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            Live Preview
            <Badge variant="secondary" className="text-xs">{preview.total} items</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {preview.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No items produced with this mapping.</p>
          ) : (
            <div className="space-y-0.5 max-h-[500px] overflow-y-auto">
              {preview.items.map((item, i) => (
                <div
                  key={item.id}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm ${i % 2 === 0 ? 'bg-muted/30' : ''}`}
                  style={{ paddingLeft: `${12 + (item.levelDepth - 1) * 24}px` }}
                >
                  <Badge variant="outline" className="text-xs shrink-0">{item.levelName}</Badge>
                  <span className="truncate">{item.name}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
