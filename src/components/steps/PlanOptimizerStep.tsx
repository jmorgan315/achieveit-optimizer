import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
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
import { PlanItem, PlanLevel, OrgProfile, DedupRemovedDetail } from '@/types/plan';
import { SaveStatus } from '@/hooks/useAutoSave';
import { SortableTreeItem, DropPosition } from '@/components/plan-optimizer/SortableTreeItem';
import { EditItemDialog } from '@/components/plan-optimizer/EditItemDialog';
import { SessionSummaryCard } from '@/components/plan-optimizer/SessionSummaryCard';
import { ConfidenceBanner } from '@/components/plan-optimizer/ConfidenceBanner';
import { LevelVerificationModal } from '@/components/steps/LevelVerificationModal';
import { Sparkles, Loader2, RefreshCw, Settings, Target, Download, Eye, MessageSquare, Upload } from 'lucide-react';
import { FeedbackDialog } from '@/components/plan-optimizer/FeedbackDialog';
import { InlineEditableTable } from '@/components/plan-optimizer/InlineEditableTable';
import { DedupSummaryCard } from '@/components/plan-optimizer/DedupSummaryCard';
import { ColumnVisibilityPopover } from '@/components/plan-optimizer/ColumnVisibilityPopover';
import { BulkActionBar } from '@/components/plan-optimizer/BulkActionBar';
import { ReimportDialog } from '@/components/plan-optimizer/ReimportDialog';
import { ReimportHistoryCard, ReimportHistory } from '@/components/plan-optimizer/ReimportHistoryCard';
import { DEFAULT_VISIBLE_COLUMNS, ALL_COLUMNS } from '@/components/plan-optimizer/columnDefs';
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
  dedupResults?: DedupRemovedDetail[];
  reimportHistory?: ReimportHistory | null;
  saveStatus?: SaveStatus;
  userId?: string;
  featureFlags?: Record<string, boolean>;
  initialItemCount?: number;
  onUpdateItem: (id: string, updates: Partial<PlanItem>) => void;
  onMoveItem: (itemId: string, newParentId: string | null) => void;
  onChangeLevel?: (itemId: string, newLevelDepth: number) => void;
  onReorderSiblings?: (itemId: string, newIndex: number) => void;
  onMoveAndReorder?: (itemId: string, newParentId: string | null, newIndex: number) => void;
  onExport: () => void;
  onUpdateLevels?: (levels: PlanLevel[]) => void;
  onDeleteItem?: (id: string) => void;
  onBack?: () => void;
  onStartOver?: () => void;
  onRestoreDedupItem?: (detail: DedupRemovedDetail) => void;
  onDismissDedupItem?: (detail: DedupRemovedDetail) => void;
  onApplyReimport?: (items: PlanItem[]) => void;
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
  dedupResults,
  reimportHistory,
  saveStatus,
  userId,
  featureFlags,
  initialItemCount,
  onUpdateItem,
  onMoveItem,
  onChangeLevel,
  onReorderSiblings,
  onMoveAndReorder,
  onExport,
  onUpdateLevels,
  onDeleteItem,
  onBack,
  onStartOver,
  onRestoreDedupItem,
  onDismissDedupItem,
  onApplyReimport,
}: PlanOptimizerStepProps) {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(() => {
    if (items.length <= 80) return new Set(items.map((i) => i.id));
    // Large imports: start fully collapsed so only root items render
    return new Set<string>();
  });
  const [selectedItem, setSelectedItem] = useState<PlanItem | null>(null);
  const [showMetricDialog, setShowMetricDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showLevelModal, setShowLevelModal] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dropInfo, setDropInfo] = useState<DropInfo | null>(null);
  const [activeFilter, setActiveFilter] = useState<'missing-owner' | 'missing-dates' | 'orphan' | 'has-metric' | 'missing-metric' | 'needs-review' | null>(null);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showFeedbackDialog, setShowFeedbackDialog] = useState(false);
  const [hasFeedback, setHasFeedback] = useState(false);
  const [reimportDialogOpen, setReimportDialogOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1024);
  const [includeConfidence, setIncludeConfidence] = useState(false);
  const [showConfidence, setShowConfidence] = useState(() => {
    return localStorage.getItem('achieveit-show-confidence') === 'true';
  });

  // Column visibility state
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => {
    if (sessionId) {
      const saved = localStorage.getItem(`achieveit-columns-${sessionId}`);
      if (saved) {
        try {
          const arr = JSON.parse(saved) as string[];
          // Ensure always-visible columns are included
          const s = new Set(arr);
          for (const col of ALL_COLUMNS) {
            if (col.alwaysVisible) s.add(col.key);
          }
          return s;
        } catch {}
      }
    }
    return new Set(DEFAULT_VISIBLE_COLUMNS);
  });

  // Bulk selection state
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  
  // Check if feedback exists
  useEffect(() => {
    if (!sessionId || !userId) return;
    supabase
      .from('session_feedback')
      .select('id')
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }) => setHasFeedback(!!data));
  }, [sessionId, userId]);

  useEffect(() => {
    const mql = window.matchMedia('(min-width: 1024px)');
    const onChange = () => setIsDesktop(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  // Save column visibility when it changes
  useEffect(() => {
    if (sessionId) {
      localStorage.setItem(`achieveit-columns-${sessionId}`, JSON.stringify([...visibleColumns]));
    }
  }, [visibleColumns, sessionId]);

  // Keyboard shortcuts for bulk selection
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedItems.size > 0) {
        setSelectedItems(new Set());
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [selectedItems.size]);

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

  const computeDropPosition = useCallback((rect: DOMRect, mouseY: number): DropPosition => {
    const height = rect.height;
    const relativeY = mouseY - rect.top;
    if (relativeY < height * 0.25) return 'before';
    if (relativeY > height * 0.75) return 'after';
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
    } else if (onMoveAndReorder) {
      const targetParentId = targetItem.parentId;
      const siblings = items.filter((i) => i.parentId === targetParentId && i.id !== draggedId);
      const targetIndex = siblings.findIndex((s) => s.id === targetId);
      
      const newIndex = position === 'before' ? targetIndex : targetIndex + 1;
      
      onMoveAndReorder(draggedId, targetParentId, newIndex);
      
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

  const needsReviewCount = items.filter(i => (i.confidence ?? 100) < 80).length;

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
    <div className="w-full space-y-6">
      <div className="max-w-6xl mx-auto space-y-6">
      {/* Session Summary + Confidence Banner — only when toggle is on */}
      {showConfidence && <SessionSummaryCard sessionId={sessionId} items={items} />}
      {showConfidence && <ConfidenceBanner items={items} />}

      {/* Dedup Summary — between confidence banner and stats */}
      {dedupResults && dedupResults.length > 0 && onRestoreDedupItem && (() => {
        const filtered = dedupResults.filter(d => !(d.removed_name === d.kept_name && d.removed_parent === d.kept_parent));
        return filtered.length > 0 ? (
          <DedupSummaryCard dedupResults={filtered} onRestore={onRestoreDedupItem} onDismiss={onDismissDedupItem} />
        ) : null;
      })()}

      {/* Reimport History */}
      {reimportHistory && <ReimportHistoryCard history={reimportHistory} />}

      {/* Stats Bar Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
          {/* AI Confidence toggle */}
          <div className="flex items-center gap-2">
            <Switch
              checked={showConfidence}
              onCheckedChange={(checked) => {
                setShowConfidence(checked);
                localStorage.setItem('achieveit-show-confidence', String(checked));
                if (!checked) setActiveFilter(prev => prev === 'needs-review' ? null : prev);
              }}
            />
            <Label className="text-sm text-muted-foreground">AI Confidence</Label>
          </div>
          {showConfidence && needsReviewCount > 0 && (
            <Button
              variant={activeFilter === 'needs-review' ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleFilterClick('needs-review')}
            >
              <Eye className="h-4 w-4 mr-1" />
              {needsReviewCount} Need Review
            </Button>
          )}
          <div className="flex items-center gap-3">
            {saveStatus === 'saving' && (
              <span className="text-xs text-muted-foreground animate-pulse">Saving...</span>
            )}
            {saveStatus === 'saved' && (
              <span className="text-xs text-muted-foreground">Saved ✓</span>
            )}
            {featureFlags?.showFeedback && sessionId && userId && (
              <Button variant={hasFeedback ? 'outline' : 'secondary'} size="sm" onClick={() => setShowFeedbackDialog(true)}>
                <MessageSquare className="h-4 w-4 mr-2" />
                {hasFeedback ? 'Edit Feedback' : 'Rate This Import'}
              </Button>
            )}
            {featureFlags?.showReimport && onApplyReimport && (
              <Button variant="outline" size="sm" onClick={() => setReimportDialogOpen(true)}>
                <Upload className="h-4 w-4 mr-2" />
                Re-Import
              </Button>
            )}
            <Button onClick={() => setShowExportDialog(true)} size="sm">
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </div>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 sm:gap-4">
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
            <div className="text-sm text-muted-foreground">Missing Assigned To</div>
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

      </div>

      {/* Plan Structure — Desktop: inline table, Mobile: tree items */}
      <Card>
        <CardHeader className="border-b">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Plan Structure</CardTitle>
              <p className="text-sm text-muted-foreground">
                {isDesktop ? 'Click any cell to edit inline' : 'Drag items to reorganize hierarchy'}
              </p>
            </div>
            {onUpdateLevels && (
              <div className="flex items-center gap-2">
                <ColumnVisibilityPopover
                  visibleColumns={visibleColumns}
                  onToggleColumn={(key) => {
                    setVisibleColumns((prev) => {
                      const next = new Set(prev);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      if (sessionId) localStorage.setItem(`achieveit-columns-${sessionId}`, JSON.stringify([...next]));
                      return next;
                    });
                  }}
                  onShowAll={() => {
                    const all = new Set(ALL_COLUMNS.map((c) => c.key));
                    setVisibleColumns(all);
                    if (sessionId) localStorage.setItem(`achieveit-columns-${sessionId}`, JSON.stringify([...all]));
                  }}
                  onResetDefaults={() => {
                    setVisibleColumns(new Set(DEFAULT_VISIBLE_COLUMNS));
                    if (sessionId) localStorage.setItem(`achieveit-columns-${sessionId}`, JSON.stringify([...DEFAULT_VISIBLE_COLUMNS]));
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowLevelModal(true)}
                >
                  <Settings className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Configure Levels</span>
                </Button>
              </div>
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
              {isDesktop ? (
                <InlineEditableTable
                  flatList={flatList}
                  items={items}
                  levels={levels}
                  expandedItems={expandedItems}
                  visibleColumns={visibleColumns}
                  selectedItems={selectedItems}
                  onToggleExpand={toggleExpand}
                  onUpdateItem={onUpdateItem}
                  onChangeLevel={onChangeLevel}
                  onOptimize={handleOptimize}
                  onEdit={handleEdit}
                  onDelete={onDeleteItem ? handleDelete : undefined}
                  onSelectItem={(id) => {
                    setSelectedItems((prev) => {
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    });
                  }}
                  onSelectAll={() => {
                    setSelectedItems((prev) => {
                      const allIds = flatList.map((f) => f.item.id);
                      const allSelected = allIds.every((id) => prev.has(id));
                      if (allSelected) return new Set();
                      return new Set(allIds);
                    });
                  }}
                  showConfidence={showConfidence}
                  activeFilter={activeFilter}
                  dropInfo={dropInfo}
                  sessionId={sessionId}
                />
              ) : (
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
                      sessionId={sessionId}
                      showConfidence={showConfidence}
                      dimmed={showConfidence && activeFilter === 'needs-review' && (item.confidence ?? 100) >= 80}
                    />
                    );
                  })}
                </div>
              )}
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

      {/* Export Dialog */}
      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Export Plan</DialogTitle>
            <DialogDescription>
              Choose your export format.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
              <Checkbox
                id="include-confidence"
                checked={includeConfidence}
                onCheckedChange={(checked) => setIncludeConfidence(checked === true)}
              />
              <div>
                <Label htmlFor="include-confidence" className="font-medium cursor-pointer">
                  Include AI confidence data
                </Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Adds "Confidence Score" and "Corrections" columns. This will NOT match AchieveIt's standard import format.
                </p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {includeConfidence
                ? '📊 Extended Export (with AI confidence data)'
                : '✅ AchieveIt Import Format (standard 18 columns)'}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExportDialog(false)}>Cancel</Button>
            <Button onClick={() => {
              exportToExcel(items, levels, includeConfidence);
              setShowExportDialog(false);
              toast({ title: 'Export complete', description: includeConfidence ? 'Extended CSV downloaded' : 'AchieveIt import file downloaded' });
            }}>
              <Download className="h-4 w-4 mr-2" />
              Download CSV
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Action Bar */}
      {isDesktop && (
        <BulkActionBar
          selectedCount={selectedItems.size}
          onBulkUpdate={(field, value) => {
            const count = selectedItems.size;
            selectedItems.forEach((id) => onUpdateItem(id, { [field]: value }));
            setSelectedItems(new Set());
            const label = ALL_COLUMNS.find((c) => c.key === field)?.label ?? field;
            toast({ title: `${label} updated`, description: `Set ${label.toLowerCase()} for ${count} items` });
          }}
          onBulkDelete={() => {
            if (onDeleteItem) {
              const count = selectedItems.size;
              selectedItems.forEach((id) => onDeleteItem(id));
              setSelectedItems(new Set());
              toast({ title: 'Items deleted', description: `Deleted ${count} items` });
            }
          }}
          onClearSelection={() => setSelectedItems(new Set())}
        />
      )}

      {featureFlags?.showFeedback && sessionId && userId && (
        <FeedbackDialog
          open={showFeedbackDialog}
          onOpenChange={setShowFeedbackDialog}
          sessionId={sessionId}
          userId={userId}
          actualItemCount={initialItemCount ?? items.length}
          onSubmitted={() => setHasFeedback(true)}
        />
      )}
      {featureFlags?.showReimport && onApplyReimport && (
        <ReimportDialog
          open={reimportDialogOpen}
          onOpenChange={setReimportDialogOpen}
          currentItems={items}
          sessionId={sessionId}
          onApply={onApplyReimport}
        />
      )}
    </div>
  );
}
