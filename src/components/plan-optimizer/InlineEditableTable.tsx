import { useState, useCallback, useRef, memo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { ALL_COLUMNS, ColumnDef } from './columnDefs';

/* ── Column width state ── */

type ColumnWidths = Record<string, number>;

function getDefaultWidths(): ColumnWidths {
  const w: ColumnWidths = {};
  for (const col of ALL_COLUMNS) {
    if (!col.flex) w[col.key] = col.defaultWidth;
  }
  w['actions'] = 110;
  return w;
}

const MIN_COL_WIDTH = 60;

function buildGridTemplate(visibleColumns: Set<string>, widths: ColumnWidths): string {
  // Fixed: drag-handle(36px) + checkbox(28px) + visible columns + actions
  const parts: string[] = ['36px', '28px'];
  for (const col of ALL_COLUMNS) {
    if (!visibleColumns.has(col.key)) continue;
    if (col.flex) {
      parts.push('1fr');
    } else {
      parts.push(`${widths[col.key] ?? col.defaultWidth}px`);
    }
  }
  parts.push(`${widths['actions'] ?? 110}px`);
  return parts.join(' ');
}

/* ── Helpers to get/set item field values ── */

function getItemValue(item: PlanItem, colKey: string): string {
  switch (colKey) {
    case 'order': return item.order;
    case 'level': return String(item.levelDepth);
    case 'name': return item.name;
    case 'description': return item.description;
    case 'status': return item.status;
    case 'startDate': return item.startDate;
    case 'dueDate': return item.dueDate;
    case 'assignedTo': return item.assignedTo;
    case 'members': return item.members.join(', ');
    case 'administrators': return item.administrators.join(', ');
    case 'updateFrequency': return item.updateFrequency;
    case 'metricDescription': return item.metricDescription;
    case 'metricUnit': return item.metricUnit;
    case 'metricRollup': return item.metricRollup;
    case 'metricBaseline': return item.metricBaseline;
    case 'metricTarget': return item.metricTarget;
    case 'currentValue': return item.currentValue;
    case 'tags': return item.tags.join(', ');
    default: return '';
  }
}

function buildUpdate(colKey: string, value: string): Partial<PlanItem> {
  switch (colKey) {
    case 'members': return { members: value.split(',').map(s => s.trim()).filter(Boolean) };
    case 'administrators': return { administrators: value.split(',').map(s => s.trim()).filter(Boolean) };
    case 'tags': return { tags: value.split(',').map(s => s.trim()).filter(Boolean) };
    default: return { [colKey]: value } as Partial<PlanItem>;
  }
}

/* ── Row component ── */

interface InlineEditableRowProps {
  item: PlanItem;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  levels: PlanLevel[];
  visibleColumns: Set<string>;
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
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
}

const InlineEditableRow = memo(function InlineEditableRow({
  item,
  depth,
  hasChildren,
  isExpanded,
  levels,
  visibleColumns,
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
  isSelected,
  onToggleSelect,
}: InlineEditableRowProps) {
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
    contentVisibility: 'auto' as const,
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

  const renderCell = (col: ColumnDef) => {
    const value = getItemValue(item, col.key);

    // Special: order is readonly
    if (col.key === 'order') {
      return (
        <div key={col.key} className="px-1 py-1">
          <span className="text-sm text-muted-foreground">{item.order}</span>
        </div>
      );
    }

    // Special: level uses custom dropdown with level change handler
    if (col.key === 'level') {
      return (
        <div key={col.key} className="py-1">
          <EditableCell
            type="dropdown"
            value={String(item.levelDepth)}
            options={levelOptions}
            className="[&>svg:last-child]:!hidden"
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
      );
    }

    // Special: name column with indent, chevron, confidence dot
    if (col.key === 'name') {
      return (
        <div key={col.key} className="py-1 flex items-start gap-1 min-w-0" style={{ paddingLeft: `${indent}px` }}>
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
            placeholder="Untitled"
            className="flex-1 min-w-0"
            displayClassName={!item.name ? 'italic' : undefined}
          />
        </div>
      );
    }

    // Special: metricTarget with amber warning if metricDescription set but target empty
    if (col.key === 'metricTarget') {
      const hasMetricDesc = !!item.metricDescription;
      const missingTarget = hasMetricDesc && !item.metricTarget;
      return (
        <div key={col.key} className="py-1">
          <EditableCell
            type={col.editType as 'text'}
            value={value}
            onChange={(v) => onUpdateItem(item.id, buildUpdate(col.key, v))}
            placeholder={missingTarget ? '—' : (col.placeholder || '—')}
            displayClassName={missingTarget ? 'text-amber-500' : undefined}
          />
        </div>
      );
    }

    // Generic column rendering
    return (
      <div key={col.key} className="py-1">
        <EditableCell
          type={col.editType as 'text' | 'textarea' | 'dropdown' | 'date'}
          value={value}
          options={col.options}
          onChange={(v) => onUpdateItem(item.id, buildUpdate(col.key, v))}
          placeholder={col.placeholder || '—'}
        />
      </div>
    );
  };

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
        } ${isSelected ? 'bg-primary/5' : ''}`}
      >
        {/* Drag handle */}
        <div className="flex items-center justify-center py-1">
          <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing touch-none">
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* Checkbox */}
        <div className="flex items-center justify-center py-1">
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onToggleSelect(item.id)}
            className="h-3.5 w-3.5"
          />
        </div>

        {/* Dynamic columns */}
        {ALL_COLUMNS.filter((c) => visibleColumns.has(c.key)).map(renderCell)}

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
}, (prev, next) => {
  return (
    prev.item === next.item &&
    prev.isExpanded === next.isExpanded &&
    prev.columnTemplate === next.columnTemplate &&
    prev.showConfidence === next.showConfidence &&
    prev.dimmed === next.dimmed &&
    prev.isOver === next.isOver &&
    prev.dropPosition === next.dropPosition &&
    prev.isSelected === next.isSelected &&
    prev.visibleColumns === next.visibleColumns &&
    prev.depth === next.depth &&
    prev.hasChildren === next.hasChildren
  );
});

/* ── Table component ── */

interface InlineEditableTableProps {
  flatList: { item: PlanItem; depth: number }[];
  items: PlanItem[];
  levels: PlanLevel[];
  expandedItems: Set<string>;
  visibleColumns: Set<string>;
  selectedItems: Set<string>;
  onToggleExpand: (id: string) => void;
  onUpdateItem: (id: string, updates: Partial<PlanItem>) => void;
  onChangeLevel?: (itemId: string, newLevelDepth: number) => void;
  onOptimize: (item: PlanItem) => void;
  onEdit: (item: PlanItem) => void;
  onDelete?: (item: PlanItem) => void;
  onSelectItem: (id: string) => void;
  onSelectAll: () => void;
  showConfidence: boolean;
  activeFilter: string | null;
  dropInfo: { itemId: string; position: DropPosition } | null;
  sessionId?: string;
}

export function InlineEditableTable({
  flatList,
  items,
  levels,
  expandedItems,
  visibleColumns,
  selectedItems,
  onToggleExpand,
  onUpdateItem,
  onChangeLevel,
  onOptimize,
  onEdit,
  onDelete,
  onSelectItem,
  onSelectAll,
  showConfidence,
  activeFilter,
  dropInfo,
  sessionId,
}: InlineEditableTableProps) {
  const [colWidths, setColWidths] = useState<ColumnWidths>(getDefaultWidths);

  const columnTemplate = buildGridTemplate(visibleColumns, colWidths);
  const getChildren = (parentId: string) => items.filter((i) => i.parentId === parentId);

  const makeResizeHandler = (key: string) => {
    return (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const baseWidth = colWidths[key] ?? 100;
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

  const allVisibleSelected = flatList.length > 0 && flatList.every(({ item }) => selectedItems.has(item.id));

  const visibleCols = ALL_COLUMNS.filter((c) => visibleColumns.has(c.key));

  return (
    <div className="w-full overflow-x-auto">
      {/* Sticky header */}
      <div
        className="grid items-center gap-0 border-b bg-muted/50 text-xs font-medium text-muted-foreground sticky top-0 z-20"
        style={{ gridTemplateColumns: columnTemplate }}
      >
        {/* Drag handle spacer */}
        <div className="px-1 py-2" />
        {/* Select all checkbox */}
        <div className="flex items-center justify-center py-2">
          <Checkbox
            checked={allVisibleSelected && flatList.length > 0}
            onCheckedChange={onSelectAll}
            className="h-3.5 w-3.5"
          />
        </div>
        {/* Column headers */}
        {visibleCols.map((col) => (
          <div key={col.key} className="px-2 py-2 relative select-none">
            {col.label}
            {!col.flex && (
              <div
                onMouseDown={makeResizeHandler(col.key)}
                className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 transition-colors"
              />
            )}
          </div>
        ))}
        {/* Actions header */}
        <div className="px-2 py-2 relative select-none">
          Actions
          <div
            onMouseDown={makeResizeHandler('actions')}
            className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 transition-colors"
          />
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
              visibleColumns={visibleColumns}
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
              isSelected={selectedItems.has(item.id)}
              onToggleSelect={onSelectItem}
            />
          );
        })}
      </div>
    </div>
  );
}
