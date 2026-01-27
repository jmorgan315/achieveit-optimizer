import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PlanItem } from '@/types/plan';
import {
  ChevronRight,
  ChevronDown,
  AlertCircle,
  Calendar,
  User,
  Sparkles,
  GripVertical,
  Settings2,
} from 'lucide-react';

interface SortableTreeItemProps {
  item: PlanItem;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  onToggleExpand: (id: string) => void;
  onOptimize: (item: PlanItem) => void;
  onEdit: (item: PlanItem) => void;
  isOver?: boolean;
}

export function SortableTreeItem({
  item,
  depth,
  hasChildren,
  isExpanded,
  onToggleExpand,
  onOptimize,
  onEdit,
  isOver,
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 py-3 px-4 border-b transition-colors ${
        hasIssues ? 'bg-destructive/5' : ''
      } ${isDragging ? 'bg-muted shadow-lg z-50' : 'hover:bg-muted/50'} ${
        isOver ? 'bg-primary/10 border-primary' : ''
      }`}
    >
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
      >
        <Settings2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
