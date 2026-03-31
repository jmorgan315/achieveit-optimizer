import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { FileSpreadsheet, ArrowRight, Info } from 'lucide-react';
import { StructureDetection } from '@/utils/spreadsheet-parser';

interface DetectionSummaryProps {
  detection: StructureDetection;
  selectedSheetIndices: number[];
  onSelectSheets: (indices: number[]) => void;
  onContinue: () => void;
}

export function DetectionSummary({ detection, selectedSheetIndices, onSelectSheets, onContinue }: DetectionSummaryProps) {
  const selectedSheets = selectedSheetIndices.map(i => detection.sheets[i]).filter(Boolean);
  const totalSelectedItems = selectedSheets.reduce((s, sd) => s + sd.totalDataRows, 0);
  const totalSelectedSections = selectedSheets.reduce((s, sd) => s + sd.sections.length, 0);

  // Collect section headers from all selected sheets
  const sectionHeaders = selectedSheets.flatMap(sd =>
    sd.sections.filter(s => s.headerText).map(s => s.headerText)
  );
  const uniqueSectionHeaders = [...new Set(sectionHeaders)];

  // Collect column headers from all selected sheets
  const allColumnHeaders = [...new Set(selectedSheets.flatMap(sd => sd.allColumnHeaders))];

  const toggleSheet = (idx: number) => {
    if (selectedSheetIndices.includes(idx)) {
      onSelectSheets(selectedSheetIndices.filter(i => i !== idx));
    } else {
      onSelectSheets([...selectedSheetIndices, idx].sort((a, b) => a - b));
    }
  };

  const selectAll = () => onSelectSheets(detection.sheets.map((_, i) => i));
  const deselectAll = () => onSelectSheets([]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            Spreadsheet Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <p className="text-2xl font-bold text-foreground">{selectedSheetIndices.length}</p>
              <p className="text-sm text-muted-foreground">Sheet{selectedSheetIndices.length !== 1 ? 's' : ''} selected</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <p className="text-2xl font-bold text-foreground">{totalSelectedItems}</p>
              <p className="text-sm text-muted-foreground">Total items</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <p className="text-2xl font-bold text-foreground">{totalSelectedSections}</p>
              <p className="text-sm text-muted-foreground">Section{totalSelectedSections !== 1 ? 's' : ''}</p>
            </div>
          </div>

          {detection.totalSheets > 1 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-foreground">Select sheets to import</label>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={selectAll} className="text-xs h-7 px-2">
                    Select All
                  </Button>
                  <Button variant="ghost" size="sm" onClick={deselectAll} className="text-xs h-7 px-2">
                    Deselect All
                  </Button>
                </div>
              </div>
              <div className="border rounded-md divide-y">
                {detection.sheets.map((sd, idx) => (
                  <label
                    key={idx}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedSheetIndices.includes(idx)}
                      onCheckedChange={() => toggleSheet(idx)}
                    />
                    <span className="text-sm flex-1">{sd.sheet.name}</span>
                    <span className="text-xs text-muted-foreground">{sd.totalDataRows} items</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Info className="h-3 w-3" />
                Items duplicated across sheets will be merged automatically
              </p>
            </div>
          )}

          {selectedSheets.length > 0 && (
            <div className="space-y-3">
              {uniqueSectionHeaders.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Detected sections</p>
                  <div className="flex flex-wrap gap-1.5">
                    {uniqueSectionHeaders.slice(0, 20).map((h, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">{h}</Badge>
                    ))}
                    {uniqueSectionHeaders.length > 20 && (
                      <Badge variant="outline" className="text-xs">+{uniqueSectionHeaders.length - 20} more</Badge>
                    )}
                  </div>
                </div>
              )}

              {allColumnHeaders.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Detected columns</p>
                  <div className="flex flex-wrap gap-1.5">
                    {allColumnHeaders.map((h, i) => (
                      <Badge key={i} variant="outline" className="text-xs">{h}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {detection.hasStrategyPattern && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Info className="h-3 w-3" />
                  Strategy/Outcome/Action pattern detected — hierarchy will be auto-mapped
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={onContinue} disabled={selectedSheetIndices.length === 0 || totalSelectedItems === 0}>
          Continue to Mapping
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}
