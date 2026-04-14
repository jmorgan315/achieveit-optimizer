import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { X, Trash2, Pencil, Check } from 'lucide-react';
import { format } from 'date-fns';
import { ALL_COLUMNS, ColumnDef } from './columnDefs';
import { cn } from '@/lib/utils';

const EDITABLE_FIELDS = ALL_COLUMNS.filter(
  (c) => !['order', 'name'].includes(c.key) && c.editType !== 'readonly'
);

interface BulkActionBarProps {
  selectedCount: number;
  onBulkUpdate: (field: string, value: string) => void;
  onBulkDelete: () => void;
  onClearSelection: () => void;
}

export function BulkActionBar({
  selectedCount,
  onBulkUpdate,
  onBulkDelete,
  onClearSelection,
}: BulkActionBarProps) {
  const [selectedField, setSelectedField] = useState<ColumnDef | null>(null);
  const [fieldValue, setFieldValue] = useState('');
  const [fieldPickerOpen, setFieldPickerOpen] = useState(false);

  if (selectedCount === 0) return null;

  const handleApply = () => {
    if (selectedField && fieldValue.trim()) {
      onBulkUpdate(selectedField.key, fieldValue.trim());
      setSelectedField(null);
      setFieldValue('');
    }
  };

  const handleSelectField = (col: ColumnDef) => {
    setSelectedField(col);
    setFieldValue('');
    setFieldPickerOpen(false);
  };

  const handleDropdownChange = (value: string) => {
    if (selectedField) {
      onBulkUpdate(selectedField.key, value);
      setSelectedField(null);
      setFieldValue('');
    }
  };

  const handleDateSelect = (date: Date | undefined) => {
    if (selectedField && date) {
      onBulkUpdate(selectedField.key, format(date, 'yyyy-MM-dd'));
      setSelectedField(null);
      setFieldValue('');
    }
  };

  const renderInlineEditor = () => {
    if (!selectedField) return null;

    if (selectedField.editType === 'dropdown' && selectedField.options) {
      return (
        <Select onValueChange={handleDropdownChange}>
          <SelectTrigger className="h-8 w-40 text-sm">
            <SelectValue placeholder={`Select ${selectedField.label}...`} />
          </SelectTrigger>
          <SelectContent>
            {selectedField.options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    if (selectedField.editType === 'date') {
      return (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-sm">
              Pick date...
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="center" side="top">
            <Calendar
              mode="single"
              onSelect={handleDateSelect}
              className={cn('p-3 pointer-events-auto')}
            />
          </PopoverContent>
        </Popover>
      );
    }

    // text / textarea
    return (
      <div className="flex items-center gap-1">
        <Input
          value={fieldValue}
          onChange={(e) => setFieldValue(e.target.value)}
          placeholder={selectedField.placeholder || `Enter ${selectedField.label.toLowerCase()}...`}
          className="h-8 w-44 text-sm"
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleApply();
          }}
        />
        <Button
          size="sm"
          className="h-8 px-2"
          disabled={!fieldValue.trim()}
          onClick={handleApply}
        >
          <Check className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-card border shadow-lg rounded-lg px-4 py-3">
      <span className="text-sm font-medium text-foreground whitespace-nowrap">
        {selectedCount} item{selectedCount !== 1 ? 's' : ''} selected
      </span>

      <div className="w-px h-6 bg-border mx-1" />

      {/* Edit Field picker */}
      <Popover open={fieldPickerOpen} onOpenChange={setFieldPickerOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8">
            <Pencil className="h-3.5 w-3.5 mr-1" />
            {selectedField ? selectedField.label : 'Edit Field'}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-1" align="start" side="top">
          <div className="max-h-64 overflow-y-auto">
            {EDITABLE_FIELDS.map((col) => (
              <button
                key={col.key}
                className="w-full text-left px-3 py-1.5 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                onClick={() => handleSelectField(col)}
              >
                {col.label}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Inline editor */}
      {renderInlineEditor()}

      <div className="w-px h-6 bg-border mx-1" />

      {/* Delete */}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10">
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            Delete
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedCount} item{selectedCount !== 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the selected items and any items nested under them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onBulkDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete {selectedCount} item{selectedCount !== 1 ? 's' : ''}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="w-px h-6 bg-border mx-1" />

      {/* Clear */}
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClearSelection} title="Clear selection">
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
