import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { CalendarIcon, ChevronDown } from 'lucide-react';
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
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
import { Badge } from '@/components/ui/badge';
import { PlanItem, PlanLevel, PlanItemStatus, UpdateFrequency, MetricDescription, MetricUnit, MetricRollup } from '@/types/plan';
import { Trash2, Target, X } from 'lucide-react';

interface EditItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: PlanItem | null;
  levels: PlanLevel[];
  onSave: (id: string, updates: Partial<PlanItem>) => void;
  onChangeLevel?: (itemId: string, newLevelDepth: number) => void;
  onDelete?: (item: PlanItem) => void;
}

interface EditFormData {
  name: string;
  description: string;
  levelDepth: number;
  status: PlanItemStatus;
  startDate: Date | undefined;
  dueDate: Date | undefined;
  assignedTo: string;
  updateFrequency: UpdateFrequency;
  members: string[];
  administrators: string[];
  tags: string[];
  metricDescription: MetricDescription;
  metricUnit: MetricUnit;
  metricRollup: MetricRollup;
  metricBaseline: string;
  metricTarget: string;
  currentValue: string;
}

export function EditItemDialog({
  open,
  onOpenChange,
  item,
  levels,
  onSave,
  onChangeLevel,
  onDelete,
}: EditItemDialogProps) {
  const [formData, setFormData] = useState<EditFormData>({
    name: '',
    description: '',
    levelDepth: 1,
    startDate: undefined,
    dueDate: undefined,
    assignedTo: '',
    members: [],
    tags: [],
    metricDescription: '',
    metricUnit: '',
    metricRollup: '',
    metricBaseline: '',
    metricTarget: '',
    currentValue: '',
  });
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [newMember, setNewMember] = useState('');
  const [newAdmin, setNewAdmin] = useState('');
  const [newTag, setNewTag] = useState('');

  useEffect(() => {
    if (item) {
      setFormData({
        name: item.name,
        description: item.description,
        levelDepth: item.levelDepth,
        status: item.status,
        startDate: item.startDate ? (() => { const d = new Date(item.startDate); return Number.isNaN(d.getTime()) ? undefined : d; })() : undefined,
        dueDate: item.dueDate ? (() => { const d = new Date(item.dueDate); return Number.isNaN(d.getTime()) ? undefined : d; })() : undefined,
        assignedTo: item.assignedTo,
        updateFrequency: item.updateFrequency,
        members: item.members ?? [],
        administrators: item.administrators ?? [],
        tags: item.tags ?? [],
        metricDescription: item.metricDescription,
        metricUnit: item.metricUnit,
        metricRollup: item.metricRollup,
        metricBaseline: item.metricBaseline,
        metricTarget: item.metricTarget,
        currentValue: item.currentValue,
      });
      setMetricsOpen(!!item.metricDescription);
      setNewMember('');
      setNewAdmin('');
      setNewTag('');
    }
  }, [item]);

  const bothDatesEmpty = !formData.startDate && !formData.dueDate;
  const bothDatesFilled = formData.startDate && formData.dueDate;
  const onlyOneDate = (formData.startDate && !formData.dueDate) || (!formData.startDate && formData.dueDate);
  const datesValid = bothDatesFilled ? formData.dueDate >= formData.startDate : true;
  const canSave = (bothDatesEmpty || (bothDatesFilled && datesValid));

  const handleSave = () => {
    if (!item || !canSave) return;

    if (formData.levelDepth !== item.levelDepth && onChangeLevel) {
      onChangeLevel(item.id, formData.levelDepth);
    }

    onSave(item.id, {
      name: formData.name,
      description: formData.description,
      status: formData.status,
      startDate: formData.startDate ? format(formData.startDate, 'yyyy-MM-dd') : '',
      dueDate: formData.dueDate ? format(formData.dueDate, 'yyyy-MM-dd') : '',
      assignedTo: formData.assignedTo,
      updateFrequency: formData.updateFrequency,
      members: formData.members,
      administrators: formData.administrators,
      tags: formData.tags,
      metricDescription: formData.metricDescription,
      metricUnit: formData.metricUnit,
      metricRollup: formData.metricRollup,
      metricBaseline: formData.metricBaseline,
      metricTarget: formData.metricTarget,
      currentValue: formData.currentValue,
    });

    onOpenChange(false);
  };

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
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

          {/* Status */}
          <div className="space-y-2">
            <Label>Status</Label>
            <Select
              value={formData.status || 'none'}
              onValueChange={(value) =>
                setFormData((prev) => ({ ...prev, status: (value === 'none' ? '' : value) as PlanItemStatus }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="Not Started">Not Started</SelectItem>
                <SelectItem value="On Track">On Track</SelectItem>
                <SelectItem value="Off Track">Off Track</SelectItem>
                <SelectItem value="At Risk">At Risk</SelectItem>
                <SelectItem value="Achieved">Achieved</SelectItem>
                <SelectItem value="Not Achieved">Not Achieved</SelectItem>
                <SelectItem value="Cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
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

          {/* Update Frequency */}
          <div className="space-y-2">
            <Label>Update Frequency</Label>
            <Select
              value={formData.updateFrequency || 'none'}
              onValueChange={(value) =>
                setFormData((prev) => ({ ...prev, updateFrequency: (value === 'none' ? '' : value) as UpdateFrequency }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select frequency" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="Not Required">Not Required</SelectItem>
                <SelectItem value="Daily">Daily</SelectItem>
                <SelectItem value="Weekly">Weekly</SelectItem>
                <SelectItem value="Biweekly">Biweekly</SelectItem>
                <SelectItem value="Monthly">Monthly</SelectItem>
                <SelectItem value="Quarterly">Quarterly</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Members */}
          <div className="space-y-2">
            <Label>Members</Label>
            <div className="flex flex-wrap gap-1.5">
              {formData.members.map((m, i) => (
                <Badge key={i} variant="secondary" className="text-xs gap-1 pr-1">
                  {m}
                  <button
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, members: prev.members.filter((_, j) => j !== i) }))}
                    className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={newMember}
                onChange={(e) => setNewMember(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const v = newMember.trim();
                    if (v) { setFormData(prev => ({ ...prev, members: [...prev.members, v] })); setNewMember(''); }
                  }
                }}
                placeholder="Add member…"
                className="h-8 text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs shrink-0"
                onClick={() => { const v = newMember.trim(); if (v) { setFormData(prev => ({ ...prev, members: [...prev.members, v] })); setNewMember(''); } }}
              >
                Add
              </Button>
            </div>
          </div>

          {/* Administrators */}
          <div className="space-y-2">
            <Label>Administrators</Label>
            <div className="flex flex-wrap gap-1.5">
              {formData.administrators.map((a, i) => (
                <Badge key={i} variant="secondary" className="text-xs gap-1 pr-1">
                  {a}
                  <button
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, administrators: prev.administrators.filter((_, j) => j !== i) }))}
                    className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={newAdmin}
                onChange={(e) => setNewAdmin(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const v = newAdmin.trim();
                    if (v) { setFormData(prev => ({ ...prev, administrators: [...prev.administrators, v] })); setNewAdmin(''); }
                  }
                }}
                placeholder="Add administrator…"
                className="h-8 text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs shrink-0"
                onClick={() => { const v = newAdmin.trim(); if (v) { setFormData(prev => ({ ...prev, administrators: [...prev.administrators, v] })); setNewAdmin(''); } }}
              >
                Add
              </Button>
            </div>
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <Label>Tags</Label>
            <div className="flex flex-wrap gap-1.5">
              {formData.tags.map((t, i) => (
                <Badge key={i} variant="outline" className="text-xs gap-1 pr-1">
                  {t}
                  <button
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, tags: prev.tags.filter((_, j) => j !== i) }))}
                    className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const v = newTag.trim();
                    if (v) { setFormData(prev => ({ ...prev, tags: [...prev.tags, v] })); setNewTag(''); }
                  }
                }}
                placeholder="Add tag…"
                className="h-8 text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs shrink-0"
                onClick={() => { const v = newTag.trim(); if (v) { setFormData(prev => ({ ...prev, tags: [...prev.tags, v] })); setNewTag(''); } }}
              >
                Add
              </Button>
            </div>
          </div>

          {/* Metrics Section */}
          <Collapsible open={metricsOpen} onOpenChange={setMetricsOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full justify-between p-2 h-auto">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Target className="h-4 w-4" />
                  Metrics
                  {formData.metricDescription && (
                    <span className="text-xs text-primary font-normal">({formData.metricDescription})</span>
                  )}
                </span>
                <ChevronDown className={cn("h-4 w-4 transition-transform", metricsOpen && "rotate-180")} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pt-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Metric Description</Label>
                  <Select
                    value={formData.metricDescription || 'none'}
                    onValueChange={(value) =>
                      setFormData((prev) => ({ ...prev, metricDescription: (value === 'none' ? '' : value) as MetricDescription }))
                    }
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="Track to Target">Track to Target</SelectItem>
                      <SelectItem value="Maintain">Maintain</SelectItem>
                      <SelectItem value="Stay Above">Stay Above</SelectItem>
                      <SelectItem value="Stay Below">Stay Below</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Metric Unit</Label>
                  <Select
                    value={formData.metricUnit || 'none'}
                    onValueChange={(value) =>
                      setFormData((prev) => ({ ...prev, metricUnit: (value === 'none' ? '' : value) as MetricUnit }))
                    }
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Select unit" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="Number">Number</SelectItem>
                      <SelectItem value="Dollar">Dollar</SelectItem>
                      <SelectItem value="Percentage">Percentage</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Rollup</Label>
                <Select
                  value={formData.metricRollup || 'none'}
                  onValueChange={(value) =>
                    setFormData((prev) => ({ ...prev, metricRollup: (value === 'none' ? '' : value) as MetricRollup }))
                  }
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Select rollup" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="Manual">Manual</SelectItem>
                    <SelectItem value="Sum Children">Sum Children</SelectItem>
                    <SelectItem value="Average Children">Average Children</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Baseline</Label>
                  <Input
                    className="h-8 text-xs"
                    value={formData.metricBaseline}
                    onChange={(e) => setFormData((prev) => ({ ...prev, metricBaseline: e.target.value }))}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Target</Label>
                  <Input
                    className="h-8 text-xs"
                    value={formData.metricTarget}
                    onChange={(e) => setFormData((prev) => ({ ...prev, metricTarget: e.target.value }))}
                    placeholder="100"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Current</Label>
                  <Input
                    className="h-8 text-xs"
                    value={formData.currentValue}
                    onChange={(e) => setFormData((prev) => ({ ...prev, currentValue: e.target.value }))}
                    placeholder="—"
                  />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <DialogFooter className="flex justify-between sm:justify-between">
          {onDelete && item ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Item
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete plan item?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete "{item.name}"? This will also remove any items nested under it. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      onDelete(item);
                      onOpenChange(false);
                    }}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : <div />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!canSave}>
              Save Changes
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
