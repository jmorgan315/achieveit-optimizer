import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { PlanLevel, PlanItem, DEFAULT_LEVELS } from '@/types/plan';
import { Plus, Trash2, Layers } from 'lucide-react';

interface LevelVerificationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  levels: PlanLevel[];
  items?: PlanItem[];
  onConfirm: (levels: PlanLevel[]) => void;
}

export function LevelVerificationModal({
  open,
  onOpenChange,
  levels: initialLevels,
  items = [],
  onConfirm,
}: LevelVerificationModalProps) {
  const [levels, setLevels] = useState<PlanLevel[]>(initialLevels);

  const addLevel = () => {
    const newId = String(Date.now());
    const newDepth = levels.length + 1;
    setLevels([...levels, { id: newId, name: `Level ${newDepth}`, depth: newDepth }]);
  };

  const getItemCountAtLevel = (level: PlanLevel) => {
    return items.filter((item) => item.levelDepth === level.depth).length;
  };

  const removeLevel = (id: string) => {
    if (levels.length <= 2) return;
    const level = levels.find((l) => l.id === id);
    if (level && getItemCountAtLevel(level) > 0) return;
    const filtered = levels.filter((l) => l.id !== id);
    setLevels(filtered.map((l, i) => ({ ...l, depth: i + 1 })));
  };

  const updateLevelName = (id: string, name: string) => {
    setLevels(levels.map((l) => (l.id === id ? { ...l, name } : l)));
  };

  const resetToDefaults = () => {
    setLevels(DEFAULT_LEVELS);
  };

  const handleConfirm = () => {
    onConfirm(levels);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Layers className="h-5 w-5 text-primary" />
            Define Your Plan Hierarchy
          </DialogTitle>
          <DialogDescription>
            Customize the levels of your strategic plan. These define how items are organized and exported to AchieveIt.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-3">
          {levels.map((level, index) => (
            <div
              key={level.id}
              className="flex items-center gap-3 p-3 rounded-lg border bg-card"
            >
              <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-sm font-semibold text-primary">{index + 1}</span>
              </div>
              <Input
                value={level.name}
                onChange={(e) => updateLevelName(level.id, e.target.value)}
                className="flex-1"
                placeholder="Level name"
              />
              {(() => {
                const itemCount = getItemCountAtLevel(level);
                const isDisabled = levels.length <= 2 || itemCount > 0;
                const button = (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeLevel(level.id)}
                    disabled={isDisabled}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                );
                if (itemCount > 0) {
                  return (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>{button}</TooltipTrigger>
                        <TooltipContent>
                          <p>{itemCount} item{itemCount !== 1 ? 's are' : ' is'} assigned to this level</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  );
                }
                return button;
              })()}
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={addLevel} className="flex-1">
            <Plus className="h-4 w-4 mr-2" />
            Add Level
          </Button>
          <Button variant="ghost" onClick={resetToDefaults}>
            Reset to Defaults
          </Button>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm}>
            Confirm Hierarchy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
