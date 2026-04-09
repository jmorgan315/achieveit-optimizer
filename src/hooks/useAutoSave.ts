import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PlanItem } from '@/types/plan';

export type SaveStatus = 'idle' | 'saving' | 'saved';

function planItemToRaw(item: PlanItem): Record<string, unknown> {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    level_name: item.levelName,
    levelType: item.levelName,
    parent_id: item.parentId,
    parent_name: '', // not needed for hydration
    owner: item.assignedTo,
    start_date: item.startDate,
    due_date: item.dueDate,
    status: item.status,
    metric_description: item.metricDescription,
    metric_unit: item.metricUnit,
    metric_rollup: item.metricRollup,
    metric_baseline: item.metricBaseline,
    metric_target: item.metricTarget,
    current_value: item.currentValue,
    update_frequency: item.updateFrequency,
    tags: item.tags,
    confidence: item.confidence,
    corrections: item.corrections,
    children: item.children.map(planItemToRaw),
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
      ...planItemToRaw(item),
      children: kids.map(convert),
    };
  }

  return roots.map(convert);
}

export function useAutoSave(
  items: PlanItem[],
  sessionId: string | undefined,
  delayMs = 2000
): SaveStatus {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRender = useRef(true);
  const lastSavedRef = useRef<string>('');

  const save = useCallback(async (currentItems: PlanItem[], sid: string) => {
    const treeItems = buildTree(currentItems);
    const itemsJson = JSON.stringify(treeItems);
    
    // Skip if nothing changed
    if (itemsJson === lastSavedRef.current) return;

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

      const updatedResults = {
        ...existingResults,
        data: {
          ...existingData,
          items: treeItems,
        },
      };

      const { error } = await supabase
        .from('processing_sessions')
        .update({ step_results: updatedResults })
        .eq('id', sid);

      if (error) {
        console.error('[AutoSave] Failed:', error.message);
        setSaveStatus('idle');
      } else {
        lastSavedRef.current = itemsJson;
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
      save(items, sessionId);
    }, delayMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [items, sessionId, delayMs, save]);

  return saveStatus;
}
