import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileSpreadsheet, ArrowRight, Info } from 'lucide-react';
import { StructureDetection } from '@/utils/spreadsheet-parser';

interface DetectionSummaryProps {
  detection: StructureDetection;
  selectedSheetIndex: number;
  onSelectSheet: (index: number) => void;
  onContinue: () => void;
}

export function DetectionSummary({ detection, selectedSheetIndex, onSelectSheet, onContinue }: DetectionSummaryProps) {
  const selectedSheet = detection.sheets[selectedSheetIndex];
  const sectionHeaders = selectedSheet?.sections
    .filter(s => s.headerText)
    .map(s => s.headerText) || [];

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
              <p className="text-2xl font-bold text-foreground">{detection.totalSheets}</p>
              <p className="text-sm text-muted-foreground">Sheet{detection.totalSheets !== 1 ? 's' : ''}</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <p className="text-2xl font-bold text-foreground">{detection.totalItems}</p>
              <p className="text-sm text-muted-foreground">Total items</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <p className="text-2xl font-bold text-foreground">{detection.totalSections}</p>
              <p className="text-sm text-muted-foreground">Section{detection.totalSections !== 1 ? 's' : ''}</p>
            </div>
          </div>

          {detection.totalSheets > 1 && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Select sheet to import</label>
              <Select
                value={String(selectedSheetIndex)}
                onValueChange={(v) => onSelectSheet(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {detection.sheets.map((sd, idx) => (
                    <SelectItem key={idx} value={String(idx)}>
                      {sd.sheet.name} ({sd.totalDataRows} items)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Info className="h-3 w-3" />
                Multi-sheet merge is coming in a future update
              </p>
            </div>
          )}

          {selectedSheet && (
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-foreground">Selected: {selectedSheet.sheet.name}</h4>

              {sectionHeaders.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Detected sections</p>
                  <div className="flex flex-wrap gap-1.5">
                    {sectionHeaders.map((h, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">{h}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {selectedSheet.allColumnHeaders.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Detected columns</p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedSheet.allColumnHeaders.map((h, i) => (
                      <Badge key={i} variant="outline" className="text-xs">{h}</Badge>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-sm text-muted-foreground">
                {selectedSheet.totalDataRows} data rows across {selectedSheet.sections.length} section{selectedSheet.sections.length !== 1 ? 's' : ''}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={onContinue} disabled={!selectedSheet || selectedSheet.totalDataRows === 0}>
          Continue to Mapping
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}
