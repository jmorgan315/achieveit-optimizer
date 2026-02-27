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
  ChevronRight,
  ChevronDown,
  AlertCircle,
  Calendar,
  User,
  Sparkles,
  GripVertical,
  Settings2,
  Trash2,
} from 'lucide-react';

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
}: SortableTreeItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

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
      default:
        return 'bg-muted';
    }
  };

  const hasIssues = item.issues.length > 0;

  const formatDateRange = () => {
    if (!item.startDate && !item.dueDate) return null;
    const start = item.startDate ? format(new Date(item.startDate), 'MMM d') : '?';
    const due = item.dueDate ? format(new Date(item.dueDate), 'MMM d, yyyy') : '?';
    return `${start} - ${due}`;
  };

  const dateRange = formatDateRange();

  // Determine visual indicator based on drop position
  const showBeforeLine = isOver && dropPosition === 'before';
  const showAfterLine = isOver && dropPosition === 'after';
  const showInsideHighlight = isOver && dropPosition === 'inside';

  return (
    <div className="relative">
      {/* Drop before indicator — thick line with circle */}
      {showBeforeLine && (
        <div className="absolute top-0 left-0 right-0 z-10" style={{ paddingLeft: `${depth * 24 + 8}px` }}>
          <div className="relative h-0.5">
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-primary border-2 border-primary" />
            <div className="absolute left-2.5 right-0 top-0 h-0.5 bg-primary" />
          </div>
          <span className="absolute left-10 -top-4 text-[10px] font-medium text-primary bg-background px-1 rounded">
            Move before
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
        {/* Nest label overlay */}
        {showInsideHighlight && (
          <span className="absolute right-4 top-1 text-[10px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full z-10">
            → Nest under {item.name}
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

        {/* Inline date display */}
        {dateRange && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {dateRange}
          </span>
        )}

        {/* Inline owner display */}
        {item.assignedTo && (
          <Badge variant="outline" className="text-xs font-normal max-w-[150px] truncate">
            <User className="h-3 w-3 mr-1" />
            {item.assignedTo}
          </Badge>
        )}

        {item.issues.map((issue, i) => (
          <Badge
            key={i}
            variant="outline"
            className={`text-xs ${getIssueColor(issue.type)}`}
          >
            {issue.type === 'missing-owner' && <User className="h-3 w-3 mr-1" />}
            {issue.type === 'missing-dates' && <Calendar className="h-3 w-3 mr-1" />}
            {issue.type === 'orphan' && <AlertCircle className="h-3 w-3 mr-1" />}
            {issue.type.replace('missing-', '')}
          </Badge>
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
      
      {/* Drop after indicator — thick line with circle */}
      {showAfterLine && (
        <div className="absolute bottom-0 left-0 right-0 z-10" style={{ paddingLeft: `${depth * 24 + 8}px` }}>
          <div className="relative h-0.5">
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-primary border-2 border-primary" />
            <div className="absolute left-2.5 right-0 top-0 h-0.5 bg-primary" />
          </div>
          <span className="absolute left-10 top-0.5 text-[10px] font-medium text-primary bg-background px-1 rounded">
            Move after
          </span>
        </div>
      )}
    </div>
  );
}
