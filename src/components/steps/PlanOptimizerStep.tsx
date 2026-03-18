import { useState, useCallback, useRef, useMemo } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  DragMoveEvent,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import { PlanItem, PlanLevel, OrgProfile } from '@/types/plan';
import { SortableTreeItem, DropPosition } from '@/components/plan-optimizer/SortableTreeItem';
import { EditItemDialog } from '@/components/plan-optimizer/EditItemDialog';
import { SessionSummaryCard } from '@/components/plan-optimizer/SessionSummaryCard';
import { ConfidenceBanner } from '@/components/plan-optimizer/ConfidenceBanner';
import { LevelVerificationModal } from '@/components/steps/LevelVerificationModal';
import { Sparkles, Loader2, RefreshCw, Settings, Target, Download, LayoutList, TreePine, Eye } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from '@/hooks/use-toast';
import { getUserFriendlyError } from '@/utils/getUserFriendlyError';
import { exportToExcel } from '@/utils/exportToExcel';

type DropInfo = { itemId: string; position: DropPosition };

interface PlanOptimizerStepProps {
  items: PlanItem[];
  levels: PlanLevel[];
  orgProfile?: OrgProfile;
  sessionId?: string;
  onUpdateItem: (id: string, updates: Partial<PlanItem>) => void;
  onMoveItem: (itemId: string, newParentId: string | null) => void;
  onChangeLevel?: (itemId: string, newLevelDepth: number) => void;
  onReorderSiblings?: (itemId: string, newIndex: number) => void;
  onExport: () => void;
  onUpdateLevels?: (levels: PlanLevel[]) => void;
  onDeleteItem?: (id: string) => void;
  onBack?: () => void;
  onStartOver?: () => void;
}

interface MetricSuggestion {
  suggestedName: string;
  metricDescription: 'Track to Target' | 'Maintain' | 'Stay Above' | 'Stay Below';
  metricUnit: 'Number' | 'Dollar' | 'Percentage';
  metricTarget: string;
  metricBaseline: string;
  rationale: string;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export function PlanOptimizerStep({
  items,
  levels,
  orgProfile,
  sessionId,
  onUpdateItem,
  onMoveItem,
  onChangeLevel,
  onReorderSiblings,
  onExport,
  onUpdateLevels,
  onDeleteItem,
  onBack,
  onStartOver,
}: PlanOptimizerStepProps) {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set(items.map((i) => i.id)));
  const [selectedItem, setSelectedItem] = useState<PlanItem | null>(null);
  const [showMetricDialog, setShowMetricDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showLevelModal, setShowLevelModal] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dropInfo, setDropInfo] = useState<DropInfo | null>(null);
  const [activeFilter, setActiveFilter] = useState<'missing-owner' | 'missing-dates' | 'orphan' | 'has-metric' | 'missing-metric' | 'needs-review' | null>(null);
  const [viewMode, setViewMode] = useState<'summary' | 'full'>('full');
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [includeConfidence, setIncludeConfidence] = useState(false);
  
  const pointerPositionRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  
  const [isLoadingSuggestion, setIsLoadingSuggestion] = useState(false);
  const [suggestion, setSuggestion] = useState<MetricSuggestion | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor)
  );

  const toggleExpand = (id: string) => {
    const next = new Set(expandedItems);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setExpandedItems(next);
  };

  const fetchSuggestion = useCallback(async (item: PlanItem) => {
    setIsLoadingSuggestion(true);
    setSuggestion(null);

    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/suggest-metrics`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: item.name,
          description: item.description,
          sessionId,
          orgProfile: orgProfile ? {
            organizationName: orgProfile.organizationName,
            industry: orgProfile.industry,
            summary: orgProfile.summary,
          } : undefined,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to get suggestion');
      }

      const data = await response.json();
      if (data.success && data.suggestion) {
        setSuggestion(data.suggestion);
      } else {
        throw new Error('Invalid response from AI');
      }
    } catch (error) {
      console.error('Suggestion error:', error);
      toast({
        title: 'Suggestion failed',
        description: getUserFriendlyError(error, 'suggestion'),
        variant: 'destructive',
      });
    } finally {
      setIsLoadingSuggestion(false);
    }
  }, [orgProfile]);

  const handleOptimize = (item: PlanItem) => {
    setSelectedItem(item);
    setShowMetricDialog(true);
    setSuggestion(null);
    fetchSuggestion(item);
  };

  const handleEdit = (item: PlanItem) => {
    setSelectedItem(item);
    setShowEditDialog(true);
  };

  const handleSaveEdit = (id: string, updates: Partial<PlanItem>) => {
    onUpdateItem(id, updates);
    toast({
      title: 'Item updated',
      description: 'Changes have been saved',
    });
  };

  const handleDelete = (item: PlanItem) => {
    if (onDeleteItem) {
      onDeleteItem(item.id);
      toast({
        title: 'Item deleted',
        description: `"${item.name}" has been removed`,
      });
    }
  };

  const applySuggestion = () => {
    if (!selectedItem || !suggestion) return;

    onUpdateItem(selectedItem.id, {
      metricDescription: suggestion.metricDescription,
      metricUnit: suggestion.metricUnit,
      metricTarget: suggestion.metricTarget,
      metricBaseline: suggestion.metricBaseline,
    });

    toast({
      title: 'Metric applied',
      description: 'AI suggestion has been applied to the item',
    });

    setShowMetricDialog(false);
    setSuggestion(null);
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
    const mouseEvent = event.activatorEvent as MouseEvent;
    if (mouseEvent) {
      pointerPositionRef.current = { x: mouseEvent.clientX, y: mouseEvent.clientY };
    }
  };

  const handleDragMove = (event: DragMoveEvent) => {
    const mouseEvent = event.activatorEvent as MouseEvent;
    if (mouseEvent && event.delta) {
      pointerPositionRef.current = {
        x: mouseEvent.clientX + event.delta.x,
        y: mouseEvent.clientY + event.delta.y,
      };
    }
  };

  const EDGE_ZONE_PX = 12;

  const computeDropPosition = useCallback((rect: DOMRect, mouseY: number): DropPosition => {
    if (mouseY < rect.top + EDGE_ZONE_PX) return 'before';
    if (mouseY > rect.bottom - EDGE_ZONE_PX) return 'after';
    return 'inside';
  }, []);

  const handleDragOver = (event: DragOverEvent) => {
    const overId = event.over?.id as string | null;
    
    const mouseEvent = event.activatorEvent as MouseEvent;
    if (mouseEvent && event.delta) {
      pointerPositionRef.current = {
        x: mouseEvent.clientX + event.delta.x,
        y: mouseEvent.clientY + event.delta.y,
      };
    }
    
    if (overId) {
      const overElement = document.querySelector(`[data-id="${overId}"]`);
      if (overElement) {
        const rect = overElement.getBoundingClientRect();
        const mouseY = pointerPositionRef.current.y;
        const position = computeDropPosition(rect, mouseY);
        setDropInfo({ itemId: overId, position });
      } else {
        setDropInfo({ itemId: overId, position: 'inside' });
      }
    } else {
      setDropInfo(null);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const currentDropInfo = dropInfo;
    setActiveId(null);
    setDropInfo(null);

    if (!over || active.id === over.id) return;

    const draggedId = active.id as string;
    const targetId = over.id as string;

    const draggedItem = items.find((i) => i.id === draggedId);
    const targetItem = items.find((i) => i.id === targetId);

    if (!draggedItem || !targetItem) return;

    const isDescendant = (parentId: string, childId: string): boolean => {
      const child = items.find((i) => i.id === childId);
      if (!child || !child.parentId) return false;
      if (child.parentId === parentId) return true;
      return isDescendant(parentId, child.parentId);
    };

    if (isDescendant(draggedId, targetId)) {
      toast({
        title: 'Invalid move',
        description: 'Cannot move an item into its own child',
        variant: 'destructive',
      });
      return;
    }

    const position = currentDropInfo?.position || 'inside';

    if (position === 'inside') {
      onMoveItem(draggedId, targetId);
      toast({
        title: 'Item moved',
        description: `"${draggedItem.name}" is now under "${targetItem.name}"`,
      });
    } else if (onReorderSiblings) {
      const targetParentId = targetItem.parentId;
      const siblings = items.filter((i) => i.parentId === targetParentId);
      const targetIndex = siblings.findIndex((s) => s.id === targetId);
      
      if (draggedItem.parentId !== targetParentId) {
        onMoveItem(draggedId, targetParentId);
      }
      
      let newIndex = position === 'before' ? targetIndex : targetIndex + 1;
      
      const draggedIndex = siblings.findIndex((s) => s.id === draggedId);
      if (draggedIndex !== -1 && draggedIndex < targetIndex) {
        newIndex = Math.max(0, newIndex - 1);
      }
      
      onReorderSiblings(draggedId, newIndex);
      
      toast({
        title: 'Item reordered',
        description: `"${draggedItem.name}" moved ${position} "${targetItem.name}"`,
      });
    }
  };

  const rootItems = items.filter((i) => !i.parentId);
  const getChildren = (parentId: string) => items.filter((i) => i.parentId === parentId);

  const itemsWithMetrics = items.filter((i) => !!i.metricDescription).length;
  const itemsWithoutMetrics = items.length - itemsWithMetrics;

  const getVisibleItemIds = useCallback((): Set<string> | null => {
    if (!activeFilter) return null;

    let matchingItems: PlanItem[];
    if (activeFilter === 'has-metric') {
      matchingItems = items.filter((i) => !!i.metricDescription);
    } else if (activeFilter === 'missing-metric') {
      matchingItems = items.filter((i) => !i.metricDescription);
    } else if (activeFilter === 'needs-review') {
      matchingItems = items.filter((i) => (i.confidence ?? 100) < 80);
    } else {
      matchingItems = items.filter((i) => i.issues.some((is) => is.type === activeFilter));
    }

    const visibleIds = new Set<string>();
    for (const item of matchingItems) {
      visibleIds.add(item.id);
      let current = item;
      while (current.parentId) {
        visibleIds.add(current.parentId);
        const parent = items.find((i) => i.id === current.parentId);
        if (!parent) break;
        current = parent;
      }
    }
    return visibleIds;
  }, [activeFilter, items]);

  const visibleItemIds = getVisibleItemIds();

  const handleFilterClick = (filter: typeof activeFilter) => {
    if (activeFilter === filter) {
      setActiveFilter(null);
    } else {
      setActiveFilter(filter);
      setExpandedItems(new Set(items.map((i) => i.id)));
    }
  };

  const buildFlatList = (parentId: string | null, depth: number): { item: PlanItem; depth: number }[] => {
    const result: { item: PlanItem; depth: number }[] = [];
    const children = parentId === null ? rootItems : getChildren(parentId);

    for (const item of children) {
      if (visibleItemIds && !visibleItemIds.has(item.id)) continue;
      result.push({ item, depth });
      if (expandedItems.has(item.id)) {
        result.push(...buildFlatList(item.id, depth + 1));
      }
    }

    return result;
  };

  const flatList = buildFlatList(null, 0);
  const activeItem = activeId ? items.find((i) => i.id === activeId) : null;

  const issueStats = {
    missingOwner: items.filter((i) => i.issues.some((is) => is.type === 'missing-owner')).length,
    missingDates: items.filter((i) => i.issues.some((is) => is.type === 'missing-dates')).length,
    orphans: items.filter((i) => i.issues.some((is) => is.type === 'orphan')).length,
  };

  const getCompletionColor = (pct: number) => {
    if (pct < 0.5) return { text: 'text-destructive', border: 'border-destructive/50' };
    if (pct < 0.75) return { text: 'text-warning', border: 'border-warning/50' };
    return { text: 'text-success', border: 'border-success/50' };
  };

  const total = items.length || 1;
  const ownerColor = getCompletionColor((total - issueStats.missingOwner) / total);
  const datesColor = getCompletionColor((total - issueStats.missingDates) / total);
  const metricsColor = getCompletionColor(itemsWithMetrics / total);
  const orphansColor = getCompletionColor((total - issueStats.orphans) / total);

  const metricLabel = activeFilter === 'has-metric' ? 'With Metrics' : activeFilter === 'missing-metric' ? 'Missing Metrics' : 'With Metrics';

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6">
      {/* View Mode Toggle + Stats Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <LayoutList className={`h-4 w-4 ${viewMode === 'summary' ? 'text-primary' : 'text-muted-foreground'}`} />
          <Switch
            checked={viewMode === 'full'}
            onCheckedChange={(checked) => setViewMode(checked ? 'full' : 'summary')}
          />
          <TreePine className={`h-4 w-4 ${viewMode === 'full' ? 'text-primary' : 'text-muted-foreground'}`} />
          <Label className="text-sm text-muted-foreground">
            {viewMode === 'full' ? 'Full Editor' : 'Summary'}
          </Label>
        </div>
        {viewMode === 'summary' && (
          <Button onClick={onExport} size="sm">
            <Download className="h-4 w-4 mr-2" />
            Download Import File
          </Button>
        )}
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-5 gap-4">
        {/* Total Items — always neutral */}
        <Card
          className={`cursor-pointer transition-all hover:shadow-md ${!activeFilter ? 'ring-2 ring-primary' : ''}`}
          onClick={() => setActiveFilter(null)}
        >
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-muted-foreground">{items.length}</div>
            <div className="text-sm text-muted-foreground">Total Items</div>
          </CardContent>
        </Card>

        {/* Missing Owners */}
        <Card
          className={`cursor-pointer transition-all hover:shadow-md ${activeFilter === 'missing-owner' ? 'ring-2 ring-primary' : ''} ${ownerColor.border}`}
          onClick={() => handleFilterClick('missing-owner')}
        >
          <CardContent className="p-4">
            <div className={`text-2xl font-bold ${ownerColor.text}`}>{issueStats.missingOwner}</div>
            <div className="text-sm text-muted-foreground">Missing Owners</div>
          </CardContent>
        </Card>

        {/* Missing Dates */}
        <Card
          className={`cursor-pointer transition-all hover:shadow-md ${activeFilter === 'missing-dates' ? 'ring-2 ring-primary' : ''} ${datesColor.border}`}
          onClick={() => handleFilterClick('missing-dates')}
        >
          <CardContent className="p-4">
            <div className={`text-2xl font-bold ${datesColor.text}`}>{issueStats.missingDates}</div>
            <div className="text-sm text-muted-foreground">Missing Dates</div>
          </CardContent>
        </Card>

        {/* With Metrics */}
        <Card
          className={`cursor-pointer transition-all hover:shadow-md ${activeFilter === 'has-metric' || activeFilter === 'missing-metric' ? 'ring-2 ring-primary' : ''} ${metricsColor.border}`}
          onClick={() => handleFilterClick(activeFilter === 'has-metric' ? 'missing-metric' : activeFilter === 'missing-metric' ? null : 'has-metric')}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-1">
              <Target className="h-4 w-4 text-primary" />
              <span className={`text-2xl font-bold ${metricsColor.text}`}>{itemsWithMetrics}/{items.length}</span>
            </div>
            <div className="text-sm text-muted-foreground">{metricLabel}</div>
          </CardContent>
        </Card>

        {/* Orphan Items */}
        <Card
          className={`cursor-pointer transition-all hover:shadow-md ${activeFilter === 'orphan' ? 'ring-2 ring-primary' : ''} ${orphansColor.border}`}
          onClick={() => handleFilterClick('orphan')}
        >
          <CardContent className="p-4">
            <div className={`text-2xl font-bold ${orphansColor.text}`}>{issueStats.orphans}</div>
            <div className="text-sm text-muted-foreground">Orphan Items</div>
          </CardContent>
        </Card>
      </div>

      {/* Summary View */}
      {viewMode === 'summary' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Plan Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Items per Level */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Items by Level</h3>
              <div className="space-y-2">
                {levels.map((level) => {
                  const count = items.filter((i) => i.levelDepth === level.depth).length;
                  const pct = items.length > 0 ? (count / items.length) * 100 : 0;
                  return (
                    <div key={level.id} className="flex items-center gap-3">
                      <span className="text-sm w-36 truncate">{level.name}</span>
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium w-8 text-right">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Coverage Stats */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Coverage</h3>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: 'Owners Assigned', value: items.length - issueStats.missingOwner, color: ownerColor },
                  { label: 'Dates Set', value: items.length - issueStats.missingDates, color: datesColor },
                  { label: 'With Metrics', value: itemsWithMetrics, color: metricsColor },
                ].map(({ label, value, color }) => {
                  const pct = items.length > 0 ? Math.round((value / items.length) * 100) : 0;
                  return (
                    <div key={label} className="text-center p-4 rounded-lg bg-muted/50">
                      <div className={`text-3xl font-bold ${color.text}`}>{pct}%</div>
                      <div className="text-sm text-muted-foreground mt-1">{label}</div>
                      <div className="text-xs text-muted-foreground">{value} / {items.length}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tree View with Drag and Drop — Full Editor only */}
      {viewMode === 'full' && (
        <Card>
        <CardHeader className="border-b">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Plan Structure</CardTitle>
              <p className="text-sm text-muted-foreground">Drag items to reorganize hierarchy</p>
            </div>
            {onUpdateLevels && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowLevelModal(true)}
              >
                <Settings className="h-4 w-4 mr-2" />
                Configure Levels
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={flatList.map((f) => f.item.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="divide-y">
                {flatList.map(({ item, depth }) => {
                  const targetItem = dropInfo?.itemId === item.id ? item : null;
                  const nestLevelName = targetItem
                    ? levels.find(l => l.depth === targetItem.levelDepth + 1)?.name || `Level ${targetItem.levelDepth + 1}`
                    : '';
                  const reorderLevelName = targetItem
                    ? targetItem.levelName
                    : '';
                  return (
                  <SortableTreeItem
                    key={item.id}
                    item={item}
                    depth={depth}
                    hasChildren={getChildren(item.id).length > 0}
                    isExpanded={expandedItems.has(item.id)}
                    onToggleExpand={toggleExpand}
                    onOptimize={handleOptimize}
                    onEdit={handleEdit}
                    onDelete={onDeleteItem ? handleDelete : undefined}
                    isOver={dropInfo?.itemId === item.id}
                    dropPosition={dropInfo?.itemId === item.id ? dropInfo.position : null}
                    targetItemName={item.name}
                    nestLevelName={nestLevelName}
                    reorderLevelName={reorderLevelName}
                  />
                  );
                })}
              </div>
            </SortableContext>

            <DragOverlay>
              {activeItem ? (
                <div className="bg-card border rounded-lg shadow-lg p-3 opacity-90 flex items-center gap-2">
                  <Badge variant="secondary">{activeItem.order}</Badge>
                  <span className="font-medium">{activeItem.name}</span>
                  {dropInfo && (() => {
                    const target = items.find(i => i.id === dropInfo.itemId);
                    if (!target) return null;
                    if (dropInfo.position === 'inside') {
                      const childLevel = levels.find(l => l.depth === target.levelDepth + 1)?.name || `Level ${target.levelDepth + 1}`;
                      return (
                        <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                          → Nest under {target.name} as {childLevel}
                        </span>
                      );
                    } else {
                      return (
                        <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                          ↕ Reorder as {target.levelName}
                        </span>
                      );
                    }
                  })()}
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </CardContent>
        </Card>
      )}

      {/* Metric Suggestion Dialog */}
      <Dialog open={showMetricDialog} onOpenChange={setShowMetricDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              AI Metric Suggestion
            </DialogTitle>
            <DialogDescription>
              Get intelligent metric recommendations for "{selectedItem?.name}"
              {orgProfile && (
                <span className="block text-xs mt-1 text-primary">
                  Context: {orgProfile.organizationName} ({orgProfile.industry})
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            {isLoadingSuggestion ? (
              <div className="flex flex-col items-center justify-center py-8 gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Generating SMART metric suggestion...</p>
              </div>
            ) : suggestion ? (
              <>
                <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                  <p className="text-sm font-medium mb-1">Suggested Metric</p>
                  <p className="text-primary font-medium">{suggestion.suggestedName}</p>
                  <p className="text-xs text-muted-foreground mt-2">{suggestion.rationale}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-muted">
                    <p className="text-xs text-muted-foreground">Description</p>
                    <p className="font-medium">{suggestion.metricDescription}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted">
                    <p className="text-xs text-muted-foreground">Unit</p>
                    <p className="font-medium">{suggestion.metricUnit}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted">
                    <p className="text-xs text-muted-foreground">Baseline</p>
                    <p className="font-medium">{suggestion.metricBaseline}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted">
                    <p className="text-xs text-muted-foreground">Target</p>
                    <p className="font-medium">{suggestion.metricTarget}</p>
                  </div>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => selectedItem && fetchSuggestion(selectedItem)}
                  className="w-full"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Regenerate Suggestion
                </Button>
              </>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">Metric Description</label>
                  <Select
                    value={selectedItem?.metricDescription || ''}
                    onValueChange={(value) =>
                      selectedItem &&
                      onUpdateItem(selectedItem.id, {
                        metricDescription: value as PlanItem['metricDescription'],
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Track to Target">Track to Target</SelectItem>
                      <SelectItem value="Maintain">Maintain</SelectItem>
                      <SelectItem value="Stay Above">Stay Above</SelectItem>
                      <SelectItem value="Stay Below">Stay Below</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium">Target Value</label>
                  <Input
                    value={selectedItem?.metricTarget || ''}
                    onChange={(e) =>
                      selectedItem && onUpdateItem(selectedItem.id, { metricTarget: e.target.value })
                    }
                    placeholder="e.g., 15"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Metric Unit</label>
                  <Select
                    value={selectedItem?.metricUnit || ''}
                    onValueChange={(value) =>
                      selectedItem &&
                      onUpdateItem(selectedItem.id, {
                        metricUnit: value as PlanItem['metricUnit'],
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select unit" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Percentage">Percentage</SelectItem>
                      <SelectItem value="Number">Number</SelectItem>
                      <SelectItem value="Dollar">Dollar</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMetricDialog(false)}>
              Cancel
            </Button>
            {suggestion ? (
              <Button onClick={applySuggestion}>
                <Sparkles className="h-4 w-4 mr-2" />
                Apply Suggestion
              </Button>
            ) : (
              <Button onClick={() => setShowMetricDialog(false)}>
                Save Changes
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Level Configuration Modal */}
      {onUpdateLevels && (
        <LevelVerificationModal
          open={showLevelModal}
          onOpenChange={setShowLevelModal}
          levels={levels}
          items={items}
          onConfirm={(newLevels) => {
            onUpdateLevels(newLevels);
            toast({
              title: 'Levels updated',
              description: 'Plan structure has been recalculated',
            });
          }}
        />
      )}

      {/* Edit Item Dialog */}
      <EditItemDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        item={selectedItem}
        levels={levels}
        onSave={handleSaveEdit}
        onChangeLevel={onChangeLevel}
        onDelete={onDeleteItem ? handleDelete : undefined}
      />
    </div>
  );
}
