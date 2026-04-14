import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Columns3 } from 'lucide-react';
import { ALL_COLUMNS, COLUMN_GROUPS, DEFAULT_VISIBLE_COLUMNS } from './columnDefs';

interface ColumnVisibilityPopoverProps {
  visibleColumns: Set<string>;
  onToggleColumn: (key: string) => void;
  onShowAll: () => void;
  onResetDefaults: () => void;
}

export function ColumnVisibilityPopover({
  visibleColumns,
  onToggleColumn,
  onShowAll,
  onResetDefaults,
}: ColumnVisibilityPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Columns3 className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">Columns</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="end" side="bottom">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Visible Columns</span>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={onShowAll}>
                Show All
              </Button>
              <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={onResetDefaults}>
                Reset
              </Button>
            </div>
          </div>

          {COLUMN_GROUPS.map((group) => {
            const cols = ALL_COLUMNS.filter((c) => c.group === group.key);
            return (
              <div key={group.key}>
                <div className="text-xs font-medium text-muted-foreground mb-1">{group.label}</div>
                <div className="space-y-1">
                  {cols.map((col) => (
                    <label
                      key={col.key}
                      className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5"
                    >
                      <Checkbox
                        checked={visibleColumns.has(col.key)}
                        disabled={col.alwaysVisible}
                        onCheckedChange={() => {
                          if (!col.alwaysVisible) onToggleColumn(col.key);
                        }}
                        className="h-3.5 w-3.5"
                      />
                      <span className={col.alwaysVisible ? 'text-muted-foreground' : ''}>
                        {col.label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
