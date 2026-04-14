import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PlanItem, PlanLevel, DedupRemovedDetail } from '@/types/plan';

export type SaveStatus = 'idle' | 'saving' | 'saved';

/** Recursively serialize a PlanItem tree in camelCase (preserving all fields). */
function serializeItem(item: PlanItem): Record<string, unknown> {
  return {
    id: item.id,
    order: item.order,
    levelName: item.levelName,
    levelDepth: item.levelDepth,
    name: item.name,
    description: item.description,
    status: item.status,
    startDate: item.startDate,
    dueDate: item.dueDate,
    assignedTo: item.assignedTo,
    members: item.members,
    administrators: item.administrators,
    updateFrequency: item.updateFrequency,
    metricDescription: item.metricDescription,
    metricUnit: item.metricUnit,
    metricRollup: item.metricRollup,
    metricBaseline: item.metricBaseline,
    metricTarget: item.metricTarget,
    currentValue: item.currentValue,
    tags: item.tags,
    parentId: item.parentId,
    confidence: item.confidence,
    corrections: item.corrections,
    children: item.children.map(serializeItem),
  };
}

function buildTree(items: PlanItem[]): Record<string, unknown>[] {
  const roots = items.filter(i => !i.parentId);
  const childrenMap = new Map<string, PlanItem[]>();
  for (const item of items) {
    if (item.parentId) {
      if (!childrenMap.has(item.parentId)) childrenMap.set(item.parentId, []);
      childrenMap.get(item.parentId)!.push(item);
    }
  }

  function convert(item: PlanItem): Record<string, unknown> {
    const kids = childrenMap.get(item.id) || [];
    return {
      ...serializeItem(item),
      children: kids.map(convert),
    };
  }

  return roots.map(convert);
}

export function useAutoSave(
  items: PlanItem[],
  dedupResults: DedupRemovedDetail[],
  sessionId: string | undefined,
  levels?: PlanLevel[],
  delayMs = 2000
): SaveStatus {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRender = useRef(true);
  const lastSavedRef = useRef<string>('');

  const save = useCallback(async (
    currentItems: PlanItem[],
    currentDedup: DedupRemovedDetail[],
    sid: string,
    currentLevels?: PlanLevel[]
  ) => {
    const treeItems = buildTree(currentItems);
    const payload = { items: treeItems, dedup: currentDedup, levels: currentLevels };
    const payloadJson = JSON.stringify(payload);
    
    // Skip if nothing changed
    if (payloadJson === lastSavedRef.current) return;

    setSaveStatus('saving');
    try {
      // Fetch current step_results to merge
      const { data: session } = await supabase
        .from('processing_sessions')
        .select('step_results')
        .eq('id', sid)
        .single();

      const existingResults = (session?.step_results as Record<string, unknown>) || {};
      const existingData = (existingResults.data as Record<string, unknown>) || {};

      const updatedData: Record<string, unknown> = {
        ...existingData,
        items: treeItems as unknown,
        format: 'planItem', // marker for direct hydration
      };

      // Save levels if provided
      if (currentLevels && currentLevels.length > 0) {
        updatedData.detectedLevels = currentLevels.map(l => ({
          depth: l.depth,
          name: l.name,
        }));
      }

      const updatedResults = {
        ...existingResults,
        data: updatedData,
        dedupResults: currentDedup as unknown,
      } as Record<string, unknown>;

      const { error } = await supabase
        .from('processing_sessions')
        .update({ step_results: updatedResults as any })
        .eq('id', sid);

      if (error) {
        console.error('[AutoSave] Failed:', error.message);
        setSaveStatus('idle');
      } else {
        lastSavedRef.current = payloadJson;
        setSaveStatus('saved');
        // Reset to idle after 3s
        setTimeout(() => setSaveStatus(prev => prev === 'saved' ? 'idle' : prev), 3000);
      }
    } catch (e) {
      console.error('[AutoSave] Exception:', e);
      setSaveStatus('idle');
    }
  }, []);

  useEffect(() => {
    // Skip first render (initial hydration)
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    if (!sessionId || items.length === 0) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      save(items, dedupResults, sessionId, levels);
    }, delayMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [items, dedupResults, sessionId, levels, delayMs, save]);

  return saveStatus;
}
