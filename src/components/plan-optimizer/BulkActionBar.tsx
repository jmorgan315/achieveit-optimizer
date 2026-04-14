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
import { X, UserPlus, CalendarIcon, Trash2, ListChecks } from 'lucide-react';
import { format } from 'date-fns';
import { PlanItem } from '@/types/plan';
import { STATUS_OPTIONS } from './columnDefs';
import { cn } from '@/lib/utils';

interface BulkActionBarProps {
  selectedCount: number;
  onSetOwner: (email: string) => void;
  onSetStatus: (status: string) => void;
  onSetDueDate: (date: string) => void;
  onBulkDelete: () => void;
  onClearSelection: () => void;
}

export function BulkActionBar({
  selectedCount,
  onSetOwner,
  onSetStatus,
  onSetDueDate,
  onBulkDelete,
  onClearSelection,
}: BulkActionBarProps) {
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerOpen, setOwnerOpen] = useState(false);

  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-card border shadow-lg rounded-lg px-4 py-3">
      <span className="text-sm font-medium text-foreground whitespace-nowrap">
        {selectedCount} item{selectedCount !== 1 ? 's' : ''} selected
      </span>

      <div className="w-px h-6 bg-border mx-1" />

      {/* Set Owner */}
      <Popover open={ownerOpen} onOpenChange={setOwnerOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <UserPlus className="h-3.5 w-3.5 mr-1" />
            Set Assigned To
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" align="center" side="top">
          <div className="space-y-2">
            <label className="text-sm font-medium">Email</label>
            <Input
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              placeholder="name@email.com"
              className="h-8 text-sm"
            />
            <Button
              size="sm"
              className="w-full"
              disabled={!ownerEmail.trim()}
              onClick={() => {
                onSetOwner(ownerEmail.trim());
                setOwnerEmail('');
                setOwnerOpen(false);
              }}
            >
              Apply
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {/* Set Status */}
      <Select onValueChange={(v) => onSetStatus(v)}>
        <SelectTrigger className="h-8 w-auto gap-1 text-sm border">
          <ListChecks className="h-3.5 w-3.5" />
          <span>Set Status</span>
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Set Due Date */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <CalendarIcon className="h-3.5 w-3.5 mr-1" />
            Set Due Date
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="center" side="top">
          <Calendar
            mode="single"
            onSelect={(date) => {
              if (date) onSetDueDate(format(date, 'yyyy-MM-dd'));
            }}
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>

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
