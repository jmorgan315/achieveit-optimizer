import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PlanItem } from '@/types/plan';
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  ChevronRight,
  ChevronDown,
  AlertCircle,
  Calendar,
  User,
  Sparkles,
  GripVertical,
  Settings2,
  Trash2,
  Target,
  AlertTriangle,
} from 'lucide-react';
import { ConfidencePopover, getConfidenceColor, hasDiscrepancy } from './ConfidencePopover';

export type DropPosition = 'before' | 'after' | 'inside' | null;

interface SortableTreeItemProps {
  item: PlanItem;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  onToggleExpand: (id: string) => void;
  onOptimize: (item: PlanItem) => void;
  onEdit: (item: PlanItem) => void;
  onDelete?: (item: PlanItem) => void;
  isOver?: boolean;
  dropPosition?: DropPosition;
  targetItemName?: string;
  nestLevelName?: string;
  reorderLevelName?: string;
  sessionId?: string;
  dimmed?: boolean;
}

export function SortableTreeItem({
  item,
  depth,
  hasChildren,
  isExpanded,
  onToggleExpand,
  onOptimize,
  onEdit,
  onDelete,
  isOver,
  dropPosition,
  targetItemName,
  nestLevelName,
  reorderLevelName,
}: SortableTreeItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, resizeObserverConfig: { disabled: true } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    paddingLeft: `${depth * 24 + 16}px`,
    opacity: isDragging ? 0.5 : 1,
  };

  const getIssueColor = (type: string) => {
    switch (type) {
      case 'missing-owner':
        return 'bg-destructive/10 border-destructive/30 text-destructive';
      case 'missing-dates':
        return 'bg-warning/10 border-warning/30 text-warning';
      case 'orphan':
        return 'bg-info/10 border-info/30 text-info';
      case 'missing-metric':
        return 'bg-muted border-muted-foreground/30 text-muted-foreground';
      default:
        return 'bg-muted';
    }
  };

  const hasIssues = item.issues.length > 0;
  const hasMetric = !!item.metricDescription;

  const formatDateRange = () => {
    if (!item.startDate && !item.dueDate) return null;
    const start = item.startDate ? format(new Date(item.startDate), 'MMM d') : '?';
    const due = item.dueDate ? format(new Date(item.dueDate), 'MMM d, yyyy') : '?';
    return `${start} - ${due}`;
  };

  const dateRange = formatDateRange();

  const showBeforeLine = isOver && dropPosition === 'before';
  const showAfterLine = isOver && dropPosition === 'after';
  const showInsideHighlight = isOver && dropPosition === 'inside';

  const metricSummary = hasMetric
    ? `${item.metricDescription} · ${item.metricUnit || 'No unit'} · Target: ${item.metricTarget || '—'}`
    : null;

  return (
    <div className="relative">
      {showBeforeLine && (
        <div className="absolute top-0 left-0 right-0 z-10" style={{ paddingLeft: `${depth * 24 + 8}px` }}>
          <div className="h-0.5 bg-primary rounded-full" />
          <span className="absolute left-10 -top-4 text-[10px] font-medium text-primary bg-background px-1.5 py-0.5 rounded shadow-sm border border-primary/20">
            Reorder before "{targetItemName}"{reorderLevelName ? ` as ${reorderLevelName}` : ''}
          </span>
        </div>
      )}
      
      <div
        ref={setNodeRef}
        style={style}
        data-id={item.id}
        className={`flex items-center gap-2 py-3 px-4 border-b transition-colors ${
          hasIssues ? 'bg-destructive/5' : ''
        } ${isDragging ? 'bg-muted shadow-lg z-50' : 'hover:bg-muted/50'} ${
          showInsideHighlight ? 'bg-primary/10 border-l-4 border-l-primary border-b' : ''
        }`}
      >
        {showInsideHighlight && (
          <span className="absolute right-4 top-1 text-[10px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full z-10">
            → Nest under "{item.name}"{nestLevelName ? ` as ${nestLevelName}` : ''}
          </span>
        )}
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing touch-none"
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </button>

        {hasChildren ? (
          <button
            onClick={() => onToggleExpand(item.id)}
            className="p-1 hover:bg-muted rounded"
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        ) : (
          <div className="w-6" />
        )}

        <Badge variant="outline" className="text-xs font-normal">
          {item.order}
        </Badge>

        <Badge variant="secondary" className="text-xs">
          {item.levelName}
        </Badge>

        <span className="font-medium flex-1 truncate">{item.name}</span>

        {/* Metric indicator — icon only */}
        {hasMetric && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center justify-center h-6 w-6 rounded bg-primary/10 text-primary cursor-default">
                  <Target className="h-3.5 w-3.5" />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">{metricSummary}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {/* Date range — icon only */}
        {dateRange && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center justify-center h-6 w-6 rounded bg-muted text-muted-foreground cursor-default">
                  <Calendar className="h-3.5 w-3.5" />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">{dateRange}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {/* Owner — icon only */}
        {item.assignedTo && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center justify-center h-6 w-6 rounded bg-muted text-muted-foreground cursor-default">
                  <User className="h-3.5 w-3.5" />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">{item.assignedTo}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {/* Issue badges — icon only */}
        {item.issues.map((issue, i) => (
          <TooltipProvider key={i}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={`inline-flex items-center justify-center h-6 w-6 rounded cursor-default ${getIssueColor(issue.type)}`}>
                  {issue.type === 'missing-owner' && <User className="h-3.5 w-3.5" />}
                  {issue.type === 'missing-dates' && <Calendar className="h-3.5 w-3.5" />}
                  {issue.type === 'orphan' && <AlertCircle className="h-3.5 w-3.5" />}
                  {issue.type === 'missing-metric' && <Target className="h-3.5 w-3.5" />}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">{issue.message}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ))}

        <Button
          variant="ghost"
          size="sm"
          onClick={() => onOptimize(item)}
        >
          <Sparkles className="h-4 w-4 mr-1" />
          Optimize
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => onEdit(item)}
          title="Edit item details"
        >
          <Settings2 className="h-4 w-4" />
        </Button>

        {onDelete && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                title="Delete item"
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4" />
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
                  onClick={() => onDelete(item)}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
      
      {showAfterLine && (
        <div className="absolute bottom-0 left-0 right-0 z-10" style={{ paddingLeft: `${depth * 24 + 8}px` }}>
          <div className="h-0.5 bg-primary rounded-full" />
          <span className="absolute left-10 top-0.5 text-[10px] font-medium text-primary bg-background px-1.5 py-0.5 rounded shadow-sm border border-primary/20">
            Reorder after "{targetItemName}"{reorderLevelName ? ` as ${reorderLevelName}` : ''}
          </span>
        </div>
      )}
    </div>
  );
}
