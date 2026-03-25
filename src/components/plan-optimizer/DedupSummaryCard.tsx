import { useState } from 'react';
import { ChevronRight, ChevronDown, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DedupRemovedDetail } from '@/types/plan';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

interface DedupSummaryCardProps {
  dedupResults: DedupRemovedDetail[];
  onRestore: (detail: DedupRemovedDetail) => void;
}

export function DedupSummaryCard({ dedupResults, onRestore }: DedupSummaryCardProps) {
  const [open, setOpen] = useState(false);

  if (!dedupResults || dedupResults.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-lg border border-border/50 bg-muted/30 px-4 py-3">
        <CollapsibleTrigger asChild>
          <button className="flex items-center gap-2 w-full text-left text-sm text-muted-foreground hover:text-foreground transition-colors">
            {open ? (
              <ChevronDown className="h-4 w-4 shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0" />
            )}
            <span>
              {dedupResults.length} duplicate {dedupResults.length === 1 ? 'item was' : 'items were'} merged during analysis
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-3 space-y-2">
            {dedupResults.map((detail, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between gap-3 rounded-md bg-background/50 border border-border/30 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">
                    {detail.removed_name}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    Merged with &lsquo;{detail.kept_name}&rsquo;
                    {detail.removed_parent ? ` under ${detail.removed_parent}` : ''}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-xs h-7 px-2 text-muted-foreground hover:text-foreground"
                  onClick={() => onRestore(detail)}
                >
                  <Undo2 className="h-3 w-3 mr-1" />
                  Restore
                </Button>
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
