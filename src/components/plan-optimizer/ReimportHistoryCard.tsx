import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, Plus, Pencil, Trash2, Upload } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export interface ReimportHistory {
  timestamp: string;
  summary: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
  };
  changes: Array<{
    type: string;
    name: string;
    order: string;
    fields?: Array<{ field: string; oldValue: string; newValue: string }>;
  }>;
}

interface ReimportHistoryCardProps {
  history: ReimportHistory;
}

export function ReimportHistoryCard({ history }: ReimportHistoryCardProps) {
  const { summary, changes } = history;
  const added = changes.filter(c => c.type === 'added');
  const removed = changes.filter(c => c.type === 'removed');
  const modified = changes.filter(c => c.type === 'modified');

  const timeAgo = formatDistanceToNow(new Date(history.timestamp), { addSuffix: true });

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="p-4">
        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-2 w-full text-left">
            <Upload className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm font-medium">Last Re-imported {timeAgo}</span>
            <span className="text-xs text-muted-foreground ml-2">
              +{summary.added} / −{summary.removed} / ~{summary.modified}
            </span>
            <ChevronDown className="h-4 w-4 text-muted-foreground ml-auto shrink-0" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-3 space-y-3 pl-6">
              {added.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium flex items-center gap-1 text-green-600">
                    <Plus className="h-3 w-3" /> {added.length} added
                  </p>
                  {added.map((c, i) => (
                    <p key={i} className="text-xs text-muted-foreground ml-4">
                      <Badge variant="outline" className="mr-1 text-[10px] py-0">{c.order}</Badge>
                      {c.name}
                    </p>
                  ))}
                </div>
              )}

              {removed.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium flex items-center gap-1 text-red-600">
                    <Trash2 className="h-3 w-3" /> {removed.length} removed
                  </p>
                  {removed.map((c, i) => (
                    <p key={i} className="text-xs text-muted-foreground ml-4 line-through">
                      <Badge variant="outline" className="mr-1 text-[10px] py-0">{c.order}</Badge>
                      {c.name}
                    </p>
                  ))}
                </div>
              )}

              {modified.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium flex items-center gap-1 text-amber-600">
                    <Pencil className="h-3 w-3" /> {modified.length} modified
                  </p>
                  {modified.map((c, i) => (
                    <div key={i} className="ml-4">
                      <p className="text-xs font-medium">
                        <Badge variant="outline" className="mr-1 text-[10px] py-0">{c.order}</Badge>
                        {c.name}
                      </p>
                      {c.fields?.map((f, j) => (
                        <p key={j} className="text-[11px] text-muted-foreground ml-4">
                          {f.field}: <span className="text-red-500">{f.oldValue}</span> → <span className="text-green-600">{f.newValue}</span>
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {summary.unchanged > 0 && (
                <p className="text-xs text-muted-foreground">{summary.unchanged} items unchanged</p>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
