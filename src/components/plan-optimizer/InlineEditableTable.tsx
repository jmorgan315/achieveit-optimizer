import { useState, useCallback, useRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';

import { PlanItem, PlanLevel } from '@/types/plan';
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
  GripVertical,
  Settings2,
  Trash2,
  Sparkles,
} from 'lucide-react';
import { EditableCell, DropdownOption } from './EditableCell';
import { ConfidencePopover, getConfidenceColor } from './ConfidencePopover';
import { DropPosition } from './SortableTreeItem';

interface ColumnWidths {
  order: number;
  level: number;
  startDate: number;
  dueDate: number;
  assignedTo: number;
  actions: number;
}

const DEFAULT_WIDTHS: ColumnWidths = {
  order: 60,
  level: 110,
  startDate: 110,
  dueDate: 110,
  assignedTo: 160,
  actions: 110,
};

const MIN_COL_WIDTH = 60;

interface InlineEditableTableProps {
  flatList: { item: PlanItem; depth: number }[];
  items: PlanItem[];
  levels: PlanLevel[];
  expandedItems: Set<string>;
  onToggleExpand: (id: string) => void;
  onUpdateItem: (id: string, updates: Partial<PlanItem>) => void;
  onChangeLevel?: (itemId: string, newLevelDepth: number) => void;
  onOptimize: (item: PlanItem) => void;
  onEdit: (item: PlanItem) => void;
  onDelete?: (item: PlanItem) => void;
  showConfidence: boolean;
  activeFilter: string | null;
  dropInfo: { itemId: string; position: DropPosition } | null;
  sessionId?: string;
}

function buildGridTemplate(w: ColumnWidths) {
  return `36px ${w.order}px ${w.level}px 1fr ${w.startDate}px ${w.dueDate}px ${w.assignedTo}px ${w.actions}px`;
}

function ResizableHeaderCell({
  children,
  columnKey,
  onResize,
}: {
  children: React.ReactNode;
  columnKey: keyof ColumnWidths;
  onResize: (key: keyof ColumnWidths, delta: number) => void;
}) {
  const handleRef = useRef<HTMLDivElement>(null);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const onMouseMove = (ev: MouseEvent) => {
        onResize(columnKey, ev.clientX - startX);
      };
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [columnKey, onResize]
  );

  return (
    <div className="px-2 py-2 relative select-none">
      {children}
      <div
        ref={handleRef}
        onMouseDown={onMouseDown}
        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 transition-colors"
      />
    </div>
  );
}

function InlineEditableRow({
  item,
  depth,
  hasChildren,
  isExpanded,
  levels,
  onToggleExpand,
  onUpdateItem,
  onChangeLevel,
  onOptimize,
  onEdit,
  onDelete,
  showConfidence,
  dimmed,
  isOver,
  dropPosition,
  targetItemName,
  nestLevelName,
  reorderLevelName,
  sessionId,
  columnTemplate,
}: {
  item: PlanItem;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  levels: PlanLevel[];
  onToggleExpand: (id: string) => void;
  onUpdateItem: (id: string, updates: Partial<PlanItem>) => void;
  onChangeLevel?: (itemId: string, newLevelDepth: number) => void;
  onOptimize: (item: PlanItem) => void;
  onEdit: (item: PlanItem) => void;
  onDelete?: (item: PlanItem) => void;
  showConfidence: boolean;
  dimmed: boolean;
  isOver: boolean;
  dropPosition: DropPosition;
  targetItemName: string;
  nestLevelName: string;
  reorderLevelName: string;
  sessionId?: string;
  columnTemplate: string;
}) {
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
    opacity: isDragging ? 0.5 : 1,
  };

  const levelOptions: DropdownOption[] = levels.map((l) => ({
    value: String(l.depth),
    label: l.name,
  }));

  const confidence = item.confidence ?? 100;
  const confColor = getConfidenceColor(confidence);
  const showConfidenceDot = showConfidence && item.confidence !== undefined;
  const needsReview = showConfidence && confidence < 80;

  const showBeforeLine = isOver && dropPosition === 'before';
  const showAfterLine = isOver && dropPosition === 'after';
  const showInsideHighlight = isOver && dropPosition === 'inside';

  const indent = depth * 24;

  return (
    <div className="relative">
      {showBeforeLine && (
        <div className="absolute top-0 left-0 right-0 z-10" style={{ paddingLeft: `${depth * 24 + 60}px` }}>
          <div className="h-0.5 bg-primary rounded-full" />
          <span className="absolute left-16 -top-4 text-[10px] font-medium text-primary bg-background px-1.5 py-0.5 rounded shadow-sm border border-primary/20">
            Reorder before "{targetItemName}"{reorderLevelName ? ` as ${reorderLevelName}` : ''}
          </span>
        </div>
      )}

      <div
        ref={setNodeRef}
        style={{
          ...style,
          gridTemplateColumns: columnTemplate,
        }}
        data-id={item.id}
        className={`group grid items-center gap-0 border-b transition-colors ${
          needsReview ? 'bg-amber-50 dark:bg-amber-950/20' : ''
        } ${!item.name ? 'bg-destructive/5' : ''} ${
          isDragging ? 'bg-muted shadow-lg z-50' : 'hover:bg-muted/50'
        } ${showInsideHighlight ? 'bg-primary/10 border-l-4 border-l-primary' : ''} ${
          dimmed ? 'opacity-40' : ''
        }`}
      >
        {/* Drag handle */}
        <div className="flex items-center justify-center py-1">
          <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing touch-none">
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* # (order) */}
        <div className="px-1 py-1">
          <span className="text-sm text-muted-foreground">{item.order}</span>
        </div>

        {/* Level */}
        <div className="py-1">
          <EditableCell
            type="dropdown"
            value={String(item.levelDepth)}
            options={levelOptions}
            onChange={(v) => {
              const newDepth = parseInt(v, 10);
              if (onChangeLevel && newDepth !== item.levelDepth) {
                onChangeLevel(item.id, newDepth);
              }
            }}
            renderDisplay={() => (
              <span className="text-sm text-foreground max-w-[100px] truncate">
                {item.levelName}
              </span>
            )}
          />
        </div>

        {/* Name — indented, with chevron + confidence */}
        <div className="py-1 flex items-start gap-1 min-w-0" style={{ paddingLeft: `${indent}px` }}>
          {hasChildren ? (
            <button
              onClick={() => onToggleExpand(item.id)}
              className="p-0.5 hover:bg-muted rounded mt-1 shrink-0"
            >
              {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          ) : (
            <div className="w-4 shrink-0" />
          )}

          {showConfidenceDot && (
            <ConfidencePopover item={item} sessionId={sessionId}>
              <button className="shrink-0 cursor-pointer mt-1.5">
                <div className={`h-2.5 w-2.5 rounded-full ${confColor.dot}`} />
              </button>
            </ConfidencePopover>
          )}

          <EditableCell
            type="textarea"
            value={item.name}
            onChange={(v) => onUpdateItem(item.id, { name: v })}
            placeholder="Item name"
            className="flex-1 min-w-0"
          />
        </div>

        {/* Start Date */}
        <div className="py-1">
          <EditableCell
            type="date"
            value={item.startDate}
            onChange={(v) => onUpdateItem(item.id, { startDate: v })}
            placeholder="—"
          />
        </div>

        {/* Due Date */}
        <div className="py-1">
          <EditableCell
            type="date"
            value={item.dueDate}
            onChange={(v) => onUpdateItem(item.id, { dueDate: v })}
            placeholder="—"
          />
        </div>

        {/* Assigned To */}
        <div className="py-1">
          <EditableCell
            type="text"
            value={item.assignedTo}
            onChange={(v) => onUpdateItem(item.id, { assignedTo: v })}
            placeholder="owner@email.com"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5 px-1 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onOptimize(item)} title="Optimize with AI">
            <Sparkles className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onEdit(item)} title="Edit all fields">
            <Settings2 className="h-3 w-3" />
          </Button>
          {onDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10"
                  title="Delete item"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete plan item?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete "{item.name}"? This will also remove any items nested under it.
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

        {showInsideHighlight && (
          <span className="absolute right-4 top-1 text-[10px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full z-10 col-span-full">
            → Nest under "{item.name}"{nestLevelName ? ` as ${nestLevelName}` : ''}
          </span>
        )}
      </div>

      {showAfterLine && (
        <div className="absolute bottom-0 left-0 right-0 z-10" style={{ paddingLeft: `${depth * 24 + 60}px` }}>
          <div className="h-0.5 bg-primary rounded-full" />
          <span className="absolute left-16 top-0.5 text-[10px] font-medium text-primary bg-background px-1.5 py-0.5 rounded shadow-sm border border-primary/20">
            Reorder after "{targetItemName}"{reorderLevelName ? ` as ${reorderLevelName}` : ''}
          </span>
        </div>
      )}
    </div>
  );
}

export function InlineEditableTable({
  flatList,
  items,
  levels,
  expandedItems,
  onToggleExpand,
  onUpdateItem,
  onChangeLevel,
  onOptimize,
  onEdit,
  onDelete,
  showConfidence,
  activeFilter,
  dropInfo,
  sessionId,
}: InlineEditableTableProps) {
  const [colWidths, setColWidths] = useState<ColumnWidths>({ ...DEFAULT_WIDTHS });
  const baseWidthsRef = useRef<ColumnWidths>({ ...DEFAULT_WIDTHS });

  const handleResizeStart = useCallback((key: keyof ColumnWidths) => {
    baseWidthsRef.current = { ...colWidths };
  }, [colWidths]);

  const handleResize = useCallback((key: keyof ColumnWidths, delta: number) => {
    setColWidths((prev) => ({
      ...prev,
      [key]: Math.max(MIN_COL_WIDTH, baseWidthsRef.current[key] + delta),
    }));
  }, []);

  const columnTemplate = buildGridTemplate(colWidths);
  const getChildren = (parentId: string) => items.filter((i) => i.parentId === parentId);

  // Wrapper that captures base on mousedown then delegates delta
  const makeResizeHandler = (key: keyof ColumnWidths) => {
    return (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const baseWidth = colWidths[key];
      const onMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        setColWidths((prev) => ({
          ...prev,
          [key]: Math.max(MIN_COL_WIDTH, baseWidth + delta),
        }));
      };
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };
  };

  return (
    <div className="w-full overflow-x-auto">
      {/* Sticky header */}
      <div
        className="grid items-center gap-0 border-b bg-muted/50 text-xs font-medium text-muted-foreground sticky top-0 z-20"
        style={{ gridTemplateColumns: columnTemplate }}
      >
        <div className="px-1 py-2" />
        <div className="px-2 py-2 relative select-none">
          #
          <div onMouseDown={makeResizeHandler('order')} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 transition-colors" />
        </div>
        <div className="px-2 py-2 relative select-none">
          Level
          <div onMouseDown={makeResizeHandler('level')} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 transition-colors" />
        </div>
        <div className="px-2 py-2">Name</div>
        <div className="px-2 py-2 relative select-none">
          Start Date
          <div onMouseDown={makeResizeHandler('startDate')} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 transition-colors" />
        </div>
        <div className="px-2 py-2 relative select-none">
          Due Date
          <div onMouseDown={makeResizeHandler('dueDate')} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 transition-colors" />
        </div>
        <div className="px-2 py-2 relative select-none">
          Assigned To
          <div onMouseDown={makeResizeHandler('assignedTo')} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 transition-colors" />
        </div>
        <div className="px-2 py-2 relative select-none">
          Actions
          <div onMouseDown={makeResizeHandler('actions')} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 transition-colors" />
        </div>
      </div>

      {/* Rows */}
      <div>
        {flatList.map(({ item, depth }) => {
          const targetItem = dropInfo?.itemId === item.id ? item : null;
          const nestLevelName = targetItem
            ? levels.find((l) => l.depth === targetItem.levelDepth + 1)?.name || `Level ${targetItem.levelDepth + 1}`
            : '';
          const reorderLevelName = targetItem ? targetItem.levelName : '';

          return (
            <InlineEditableRow
              key={item.id}
              item={item}
              depth={depth}
              hasChildren={getChildren(item.id).length > 0}
              isExpanded={expandedItems.has(item.id)}
              levels={levels}
              onToggleExpand={onToggleExpand}
              onUpdateItem={onUpdateItem}
              onChangeLevel={onChangeLevel}
              onOptimize={onOptimize}
              onEdit={onEdit}
              onDelete={onDelete}
              showConfidence={showConfidence}
              dimmed={showConfidence && activeFilter === 'needs-review' && (item.confidence ?? 100) >= 80}
              isOver={dropInfo?.itemId === item.id}
              dropPosition={dropInfo?.itemId === item.id ? dropInfo.position : null}
              targetItemName={item.name}
              nestLevelName={nestLevelName}
              reorderLevelName={reorderLevelName}
              sessionId={sessionId}
              columnTemplate={columnTemplate}
            />
          );
        })}
      </div>
    </div>
  );
}