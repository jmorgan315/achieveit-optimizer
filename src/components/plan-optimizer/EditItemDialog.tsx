import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { PlanItem, PlanLevel } from '@/types/plan';

interface EditItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: PlanItem | null;
  levels: PlanLevel[];
  onSave: (id: string, updates: Partial<PlanItem>) => void;
  onChangeLevel?: (itemId: string, newLevelDepth: number) => void;
}

interface EditFormData {
  name: string;
  description: string;
  levelDepth: number;
  startDate: Date | undefined;
  dueDate: Date | undefined;
  assignedTo: string;
}

export function EditItemDialog({
  open,
  onOpenChange,
  item,
  levels,
  onSave,
  onChangeLevel,
}: EditItemDialogProps) {
  const [formData, setFormData] = useState<EditFormData>({
    name: '',
    description: '',
    levelDepth: 1,
    startDate: undefined,
    dueDate: undefined,
    assignedTo: '',
  });

  // Reset form when item changes
  useEffect(() => {
    if (item) {
      setFormData({
        name: item.name,
        description: item.description,
        levelDepth: item.levelDepth,
        startDate: item.startDate ? new Date(item.startDate) : undefined,
        dueDate: item.dueDate ? new Date(item.dueDate) : undefined,
        assignedTo: item.assignedTo,
      });
    }
  }, [item]);

  // Date validation: both or neither
  const bothDatesEmpty = !formData.startDate && !formData.dueDate;
  const bothDatesFilled = formData.startDate && formData.dueDate;
  const onlyOneDate = (formData.startDate && !formData.dueDate) || (!formData.startDate && formData.dueDate);
  const datesValid = bothDatesFilled ? formData.dueDate >= formData.startDate : true;
  const canSave = (bothDatesEmpty || (bothDatesFilled && datesValid));

  const handleSave = () => {
    if (!item || !canSave) return;

    // Check if level changed
    if (formData.levelDepth !== item.levelDepth && onChangeLevel) {
      onChangeLevel(item.id, formData.levelDepth);
    }

    onSave(item.id, {
      name: formData.name,
      description: formData.description,
      startDate: formData.startDate ? format(formData.startDate, 'yyyy-MM-dd') : '',
      dueDate: formData.dueDate ? format(formData.dueDate, 'yyyy-MM-dd') : '',
      assignedTo: formData.assignedTo,
    });

    onOpenChange(false);
  };

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Plan Item</DialogTitle>
          <DialogDescription>
            Update the details for this plan item. Dates are optional, but if you set one, you must set both.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Item name"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Item description"
              rows={3}
            />
          </div>

          {/* Level */}
          <div className="space-y-2">
            <Label>Level</Label>
            <Select
              value={String(formData.levelDepth)}
              onValueChange={(value) =>
                setFormData((prev) => ({ ...prev, levelDepth: parseInt(value, 10) }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select level" />
              </SelectTrigger>
              <SelectContent>
                {levels.map((level) => (
                  <SelectItem key={level.id} value={String(level.depth)}>
                    {level.name} (Level {level.depth})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            {/* Start Date */}
            <div className="space-y-2">
              <Label>Start Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'w-full justify-start text-left font-normal',
                      !formData.startDate && 'text-muted-foreground'
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {formData.startDate ? format(formData.startDate, 'PPP') : <span>Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={formData.startDate}
                    onSelect={(date) => setFormData((prev) => ({ ...prev, startDate: date }))}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Due Date */}
            <div className="space-y-2">
              <Label>Due Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'w-full justify-start text-left font-normal',
                      !formData.dueDate && 'text-muted-foreground'
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {formData.dueDate ? format(formData.dueDate, 'PPP') : <span>Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={formData.dueDate}
                    onSelect={(date) => setFormData((prev) => ({ ...prev, dueDate: date }))}
                    disabled={(date) =>
                      formData.startDate ? date < formData.startDate : false
                    }
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {onlyOneDate ? (
            <p className="text-xs text-destructive">If you set one date, you must set both</p>
          ) : bothDatesFilled && !datesValid ? (
            <p className="text-xs text-destructive">Due date must be on or after start date</p>
          ) : null}

          {/* Owner */}
          <div className="space-y-2">
            <Label htmlFor="assignedTo">Owner Email</Label>
            <Input
              id="assignedTo"
              type="email"
              value={formData.assignedTo}
              onChange={(e) => setFormData((prev) => ({ ...prev, assignedTo: e.target.value }))}
              placeholder="owner@company.com"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
