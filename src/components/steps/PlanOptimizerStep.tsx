import { useState, useCallback, useRef } from 'react';
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
import { PlanItem, PlanLevel } from '@/types/plan';
import { SortableTreeItem, DropPosition } from '@/components/plan-optimizer/SortableTreeItem';
import { EditItemDialog } from '@/components/plan-optimizer/EditItemDialog';
import { LevelVerificationModal } from '@/components/steps/LevelVerificationModal';
import { Sparkles, Loader2, RefreshCw, Settings } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { getUserFriendlyError } from '@/utils/getUserFriendlyError';

type DropInfo = { itemId: string; position: DropPosition };

interface PlanOptimizerStepProps {
  items: PlanItem[];
  levels: PlanLevel[];
  onUpdateItem: (id: string, updates: Partial<PlanItem>) => void;
  onMoveItem: (itemId: string, newParentId: string | null) => void;
  onChangeLevel?: (itemId: string, newLevelDepth: number) => void;
  onReorderSiblings?: (itemId: string, newIndex: number) => void;
  onExport: () => void;
  onUpdateLevels?: (levels: PlanLevel[]) => void;
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
  onUpdateItem,
  onMoveItem,
  onChangeLevel,
  onReorderSiblings,
  onExport,
  onUpdateLevels,
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
  const [activeFilter, setActiveFilter] = useState<'missing-owner' | 'missing-dates' | 'orphan' | null>(null);
  
  // Track live pointer position for accurate drop detection
  const pointerPositionRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  
  // AI suggestion state
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
  }, []);

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
    // Initialize pointer position from activator event
    const mouseEvent = event.activatorEvent as MouseEvent;
    if (mouseEvent) {
      pointerPositionRef.current = { x: mouseEvent.clientX, y: mouseEvent.clientY };
    }
  };

  // Track live pointer position during drag
  const handleDragMove = (event: DragMoveEvent) => {
    // Use delta to calculate current position from initial position
    const mouseEvent = event.activatorEvent as MouseEvent;
    if (mouseEvent && event.delta) {
      pointerPositionRef.current = {
        x: mouseEvent.clientX + event.delta.x,
        y: mouseEvent.clientY + event.delta.y,
      };
    }
  };

  const getDropPosition = useCallback((): DropPosition => {
    const activeIdValue = activeId;
    if (!activeIdValue || !dropInfo?.itemId) return null;
    
    const overElement = document.querySelector(`[data-id="${dropInfo.itemId}"]`);
    if (!overElement) return 'inside';
    
    const rect = overElement.getBoundingClientRect();
    const mouseY = pointerPositionRef.current.y;
    
    // Calculate thresholds (20% from top and bottom for before/after, middle 60% for inside)
    const topThreshold = rect.top + rect.height * 0.2;
    const bottomThreshold = rect.bottom - rect.height * 0.2;
    
    if (mouseY < topThreshold) {
      return 'before';
    } else if (mouseY > bottomThreshold) {
      return 'after';
    } else {
      return 'inside';
    }
  }, [activeId, dropInfo?.itemId]);

  const handleDragOver = (event: DragOverEvent) => {
    const overId = event.over?.id as string | null;
    
    // Update pointer position from drag over event
    const mouseEvent = event.activatorEvent as MouseEvent;
    if (mouseEvent && event.delta) {
      pointerPositionRef.current = {
        x: mouseEvent.clientX + event.delta.x,
        y: mouseEvent.clientY + event.delta.y,
      };
    }
    
    if (overId) {
      // Calculate position based on current pointer position
      const overElement = document.querySelector(`[data-id="${overId}"]`);
      if (overElement) {
        const rect = overElement.getBoundingClientRect();
        const mouseY = pointerPositionRef.current.y;
        
        const topThreshold = rect.top + rect.height * 0.2;
        const bottomThreshold = rect.bottom - rect.height * 0.2;
        
        let position: DropPosition;
        if (mouseY < topThreshold) {
          position = 'before';
        } else if (mouseY > bottomThreshold) {
          position = 'after';
        } else {
          position = 'inside';
        }
        
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

    // Prevent dropping on own descendants
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
      // Nest: make dragged item a child of target item
      onMoveItem(draggedId, targetId);
      toast({
        title: 'Item moved',
        description: `"${draggedItem.name}" is now under "${targetItem.name}"`,
      });
    } else if (onReorderSiblings) {
      // Reorder: place before or after target
      const targetParentId = targetItem.parentId;
      const siblings = items.filter((i) => i.parentId === targetParentId);
      const targetIndex = siblings.findIndex((s) => s.id === targetId);
      
      // If dragged item has a different parent, first move it to target's parent
      if (draggedItem.parentId !== targetParentId) {
        onMoveItem(draggedId, targetParentId);
      }
      
      // Calculate new index based on drop position
      let newIndex = position === 'before' ? targetIndex : targetIndex + 1;
      
      // Adjust if dragged item was in same list and before target
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

  // Compute visible items based on active filter
  const getVisibleItemIds = useCallback((): Set<string> | null => {
    if (!activeFilter) return null; // null means show all
    const matchingItems = items.filter((i) => i.issues.some((is) => is.type === activeFilter));
    const visibleIds = new Set<string>();
    for (const item of matchingItems) {
      visibleIds.add(item.id);
      // Walk up parent chain to include ancestors
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

  // Auto-expand ancestors when filter is activated
  const handleFilterClick = (filter: 'missing-owner' | 'missing-dates' | 'orphan') => {
    if (activeFilter === filter) {
      setActiveFilter(null);
    } else {
      setActiveFilter(filter);
      // Auto-expand all items so filtered items are visible
      setExpandedItems(new Set(items.map((i) => i.id)));
    }
  };

  // Build flat list for sortable context
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

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6">
      {/* Stats Bar */}
      <div className="grid grid-cols-4 gap-4">
        <Card
          className={`cursor-pointer transition-all hover:shadow-md ${!activeFilter ? 'ring-2 ring-primary' : ''}`}
          onClick={() => setActiveFilter(null)}
        >
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-foreground">{items.length}</div>
            <div className="text-sm text-muted-foreground">Total Items</div>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-all hover:shadow-md ${activeFilter === 'missing-owner' ? 'ring-2 ring-primary' : ''} ${issueStats.missingOwner > 0 ? 'border-destructive/50' : ''}`}
          onClick={() => handleFilterClick('missing-owner')}
        >
          <CardContent className="p-4">
            <div className={`text-2xl font-bold ${issueStats.missingOwner > 0 ? 'text-destructive' : 'text-success'}`}>
              {issueStats.missingOwner}
            </div>
            <div className="text-sm text-muted-foreground">Missing Owners</div>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-all hover:shadow-md ${activeFilter === 'missing-dates' ? 'ring-2 ring-primary' : ''} ${issueStats.missingDates > 0 ? 'border-warning/50' : ''}`}
          onClick={() => handleFilterClick('missing-dates')}
        >
          <CardContent className="p-4">
            <div className={`text-2xl font-bold ${issueStats.missingDates > 0 ? 'text-warning' : 'text-success'}`}>
              {issueStats.missingDates}
            </div>
            <div className="text-sm text-muted-foreground">Missing Dates</div>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-all hover:shadow-md ${activeFilter === 'orphan' ? 'ring-2 ring-primary' : ''} ${issueStats.orphans > 0 ? 'border-info/50' : ''}`}
          onClick={() => handleFilterClick('orphan')}
        >
          <CardContent className="p-4">
            <div className={`text-2xl font-bold ${issueStats.orphans > 0 ? 'text-info' : 'text-success'}`}>
              {issueStats.orphans}
            </div>
            <div className="text-sm text-muted-foreground">Orphan Items</div>
          </CardContent>
        </Card>
      </div>

      {/* Tree View with Drag and Drop */}
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
                {flatList.map(({ item, depth }) => (
                  <div key={item.id} data-id={item.id}>
                    <SortableTreeItem
                      item={item}
                      depth={depth}
                      hasChildren={getChildren(item.id).length > 0}
                      isExpanded={expandedItems.has(item.id)}
                      onToggleExpand={toggleExpand}
                      onOptimize={handleOptimize}
                      onEdit={handleEdit}
                      isOver={dropInfo?.itemId === item.id}
                      dropPosition={dropInfo?.itemId === item.id ? dropInfo.position : null}
                    />
                  </div>
                ))}
              </div>
            </SortableContext>

            <DragOverlay>
              {activeItem ? (
                <div className="bg-card border rounded-lg shadow-lg p-3 opacity-90">
                  <Badge variant="secondary" className="mr-2">{activeItem.order}</Badge>
                  <span className="font-medium">{activeItem.name}</span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </CardContent>
      </Card>


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
      />
    </div>
  );
}
