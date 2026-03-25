import { Badge } from '@/components/ui/badge';
import { getConfidenceColor } from '@/components/plan-optimizer/ConfidencePopover';

interface TreeItem {
  name?: string;
  levelType?: string;
  level_name?: string;
  confidence?: number;
  children?: TreeItem[];
}

interface ResultsPreviewTreeProps {
  items: TreeItem[];
  totalItems?: number;
  sessionConfidence?: number;
}

function countAll(items: TreeItem[]): number {
  return items.reduce((sum, item) => sum + 1 + countAll(item.children ?? []), 0);
}

function flattenAll(items: TreeItem[]): TreeItem[] {
  const result: TreeItem[] = [];
  for (const item of items) {
    result.push(item);
    if (item.children?.length) result.push(...flattenAll(item.children));
  }
  return result;
}

function ConfidenceSummary({ items, totalItems, sessionConfidence }: { items: TreeItem[]; totalItems?: number; sessionConfidence?: number }) {
  const all = flattenAll(items);
  const total = totalItems ?? all.length;
  const highCount = all.filter(i => (i.confidence ?? 100) >= 80).length;
  const needsReview = total - highCount;
  const avg = sessionConfidence ?? (total > 0 ? Math.round(all.reduce((s, i) => s + (i.confidence ?? 100), 0) / all.length) : 100);

  const color = avg >= 80 ? 'text-emerald-600' : avg >= 60 ? 'text-amber-600' : 'text-destructive';

  return (
    <p className="text-xs text-muted-foreground px-3 py-2 border-b border-border">
      <span className={`font-medium ${color}`}>{avg}% avg confidence</span>
      {' — '}{highCount} of {total} items verified with high confidence.
      {needsReview > 0 && ` ${needsReview} item${needsReview > 1 ? 's' : ''} may need review.`}
    </p>
  );
}

function TreeRow({ item, depth }: { item: TreeItem; depth: number }) {
  const confidence = item.confidence ?? 100;
  const color = getConfidenceColor(confidence);
  const levelName = item.levelType || item.level_name || 'Item';

  return (
    <>
      <div
        className="flex items-center gap-2 px-3 py-1.5 text-sm even:bg-muted/20 hover:bg-muted/30 transition-colors"
        style={{ paddingLeft: `${12 + depth * 24}px` }}
      >
        <div className={`h-2 w-2 rounded-full shrink-0 ${color.dot}`} title={`${confidence}%`} />
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 shrink-0 font-normal">
          {levelName}
        </Badge>
        <span className="text-foreground">{item.name || '(unnamed)'}</span>
      </div>
      {item.children?.map((child, i) => (
        <TreeRow key={i} item={child} depth={depth + 1} />
      ))}
    </>
  );
}

export function ResultsPreviewTree({ items, totalItems, sessionConfidence }: ResultsPreviewTreeProps) {
  if (!items || items.length === 0) return null;

  return (
    <div>
      <ConfidenceSummary items={items} totalItems={totalItems} sessionConfidence={sessionConfidence} />
      <div className="divide-y divide-border/30">
        {items.map((item, i) => (
          <TreeRow key={i} item={item} depth={0} />
        ))}
      </div>
    </div>
  );
}
