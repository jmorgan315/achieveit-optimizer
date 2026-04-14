import { useState, useCallback } from 'react';
import {
  PlanState,
  PlanLevel,
  PlanItem,
  PersonMapping,
  OrgProfile,
  DEFAULT_LEVELS,
} from '@/types/plan';
import { parseTextToPlanItems } from '@/utils/textParser';

export function usePlanState() {
  const [state, setState] = useState<PlanState>({
    levels: DEFAULT_LEVELS,
    items: [],
    personMappings: [],
    rawText: '',
    orgProfile: undefined,
    sessionId: undefined,
  });

  const setLevels = useCallback((levels: PlanLevel[]) => {
    setState((prev) => ({ ...prev, levels }));
  }, []);

  const setRawText = useCallback((rawText: string) => {
    setState((prev) => ({ ...prev, rawText }));
  }, []);

  const setItems = useCallback((items: PlanItem[], personMappings: PersonMapping[]) => {
    setState((prev) => ({ ...prev, items, personMappings }));
  }, []);

  const setOrgProfile = useCallback((orgProfile: OrgProfile | undefined) => {
    setState((prev) => ({ ...prev, orgProfile }));
  }, []);

  const setSessionId = useCallback((sessionId: string | undefined) => {
    setState((prev) => ({ ...prev, sessionId }));
  }, []);

  const processText = useCallback(() => {
    const { items, personMappings } = parseTextToPlanItems(state.rawText, state.levels);
    setState((prev) => ({ ...prev, items, personMappings }));
  }, [state.rawText, state.levels]);

  const reorderSiblings = useCallback((itemId: string, newIndex: number) => {
    setState((prev) => {
      const item = prev.items.find((i) => i.id === itemId);
      if (!item) return prev;

      const siblings = prev.items.filter((i) => i.parentId === item.parentId);
      const currentIndex = siblings.findIndex((s) => s.id === itemId);
      if (currentIndex === -1 || currentIndex === newIndex) return prev;

      const reordered = [...siblings];
      const [moved] = reordered.splice(currentIndex, 1);
      reordered.splice(newIndex, 0, moved);

      const siblingIds = new Set(reordered.map((s) => s.id));
      const updatedItems = prev.items.map((i) => {
        if (!siblingIds.has(i.id)) return i;
        const idx = reordered.findIndex((s) => s.id === i.id);
        return { ...i, order: String(idx + 1) };
      });

      return { ...prev, items: recalculateOrders(updatedItems, prev.levels) };
    });
  }, []);


  const updatePersonMapping = useCallback((id: string, email: string) => {
    setState((prev) => ({
      ...prev,
      personMappings: prev.personMappings.map((pm) =>
        pm.id === id ? { ...pm, email, isResolved: email.includes('@') } : pm
      ),
    }));
  }, []);

  const applyPersonMappingsToItems = useCallback(() => {
    setState((prev) => {
      const emailMap = new Map(
        prev.personMappings
          .filter((pm) => pm.isResolved)
          .map((pm) => [pm.foundName.toLowerCase(), pm.email])
      );

      const updatedItems = prev.items.map((item) => {
        const updatedItem = { ...item };
        for (const [name, email] of emailMap) {
          if (item.name.toLowerCase().includes(name) || item.description.toLowerCase().includes(name)) {
            updatedItem.assignedTo = email;
            updatedItem.issues = updatedItem.issues.filter((i) => i.type !== 'missing-owner');
            break;
          }
        }
        return updatedItem;
      });

      return { ...prev, items: updatedItems };
    });
  }, []);

  const updateItem = useCallback((id: string, updates: Partial<PlanItem>) => {
    setState((prev) => ({
      ...prev,
      items: prev.items.map((item) =>
        item.id === id ? { ...item, ...updates } : item
      ),
    }));
  }, []);

  const updateItemIssues = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      items: prev.items.map((item) => {
        if (item.id !== id) return item;

        const issues: PlanItem['issues'] = [];

        if (!item.assignedTo || !item.assignedTo.includes('@')) {
          issues.push({ type: 'missing-owner', message: 'Missing assigned to email' });
        }

        if (!item.startDate || !item.dueDate) {
          issues.push({ type: 'missing-dates', message: 'Missing start or due date' });
        }

        if (!item.parentId && item.levelDepth > 1) {
          issues.push({ type: 'orphan', message: 'Item is missing a parent' });
        }

        return { ...item, issues };
      }),
    }));
  }, []);

  const moveItem = useCallback((itemId: string, newParentId: string | null) => {
    setState((prev) => {
      const itemIndex = prev.items.findIndex((i) => i.id === itemId);
      if (itemIndex === -1) return prev;

      const item = prev.items[itemIndex];
      const newParent = newParentId ? prev.items.find((i) => i.id === newParentId) : null;

      const newLevelDepth = newParent ? newParent.levelDepth + 1 : 1;
      const levelName = prev.levels.find((l) => l.depth === newLevelDepth)?.name || item.levelName;

      const updatedItems = prev.items.map((i) =>
        i.id === itemId
          ? { ...i, parentId: newParentId, levelDepth: newLevelDepth, levelName }
          : i
      );

      return { ...prev, items: recalculateOrders(updatedItems, prev.levels) };
    });
  }, []);

  const updateLevelsAndRecalculate = useCallback((newLevels: PlanLevel[]) => {
    setState((prev) => {
      const updatedItems = prev.items.map((item) => {
        const matchingLevel = newLevels.find((l) => l.depth === item.levelDepth);
        return {
          ...item,
          levelName: matchingLevel?.name || item.levelName,
        };
      });

      return {
        ...prev,
        levels: newLevels,
        items: recalculateOrders(updatedItems, newLevels),
      };
    });
  }, []);

  const changeItemLevel = useCallback((itemId: string, newLevelDepth: number) => {
    setState((prev) => {
      const item = prev.items.find((i) => i.id === itemId);
      if (!item) return prev;

      const currentDepth = item.levelDepth;
      if (currentDepth === newLevelDepth) return prev;

      let newParentId: string | null = null;

      if (newLevelDepth === 1) {
        newParentId = null;
      } else if (newLevelDepth > currentDepth) {
        const siblings = prev.items.filter((i) => i.parentId === item.parentId && i.id !== itemId);
        const itemOrderParts = item.order.split('.').map(Number);
        
        let closestSibling: PlanItem | null = null;
        for (const sibling of siblings) {
          const siblingOrderParts = sibling.order.split('.').map(Number);
          const siblingOrderNum = siblingOrderParts[siblingOrderParts.length - 1];
          const itemOrderNum = itemOrderParts[itemOrderParts.length - 1];
          if (siblingOrderNum < itemOrderNum) {
            if (!closestSibling) {
              closestSibling = sibling;
            } else {
              const closestOrderParts = closestSibling.order.split('.').map(Number);
              const closestOrderNum = closestOrderParts[closestOrderParts.length - 1];
              if (siblingOrderNum > closestOrderNum) {
                closestSibling = sibling;
              }
            }
          }
        }
        
        newParentId = closestSibling?.id || item.parentId;
      } else {
        let currentParentId = item.parentId;
        let targetParentDepth = newLevelDepth - 1;
        
        while (currentParentId) {
          const parent = prev.items.find((i) => i.id === currentParentId);
          if (!parent) break;
          
          if (parent.levelDepth === targetParentDepth) {
            newParentId = parent.id;
            break;
          } else if (parent.levelDepth < targetParentDepth) {
            newParentId = parent.id;
            break;
          }
          
          currentParentId = parent.parentId;
        }
        
        if (targetParentDepth === 0) {
          newParentId = null;
        }
      }

      const levelName = prev.levels.find((l) => l.depth === newLevelDepth)?.name || `Level ${newLevelDepth}`;
      
      const updatedItems = prev.items.map((i) =>
        i.id === itemId
          ? { ...i, parentId: newParentId, levelDepth: newLevelDepth, levelName }
          : i
      );

      return { ...prev, items: recalculateOrders(updatedItems, prev.levels) };
    });
  }, []);

  const deleteItem = useCallback((id: string) => {
    setState((prev) => {
      const getDescendantIds = (parentId: string): string[] => {
        const children = prev.items.filter((i) => i.parentId === parentId);
        return children.flatMap((child) => [child.id, ...getDescendantIds(child.id)]);
      };
      const idsToRemove = new Set([id, ...getDescendantIds(id)]);
      const remaining = prev.items.filter((i) => !idsToRemove.has(i.id));
      return { ...prev, items: recalculateOrders(remaining, prev.levels) };
    });
  }, []);

  const resetState = useCallback(() => {
    setState({
      levels: DEFAULT_LEVELS,
      items: [],
      personMappings: [],
      rawText: '',
      orgProfile: undefined,
      sessionId: undefined,
    });
  }, []);

  return {
    state,
    setLevels,
    setRawText,
    setItems,
    setOrgProfile,
    setSessionId,
    processText,
    updatePersonMapping,
    applyPersonMappingsToItems,
    updateItem,
    updateItemIssues,
    moveItem,
    reorderSiblings,
    updateLevelsAndRecalculate,
    changeItemLevel,
    deleteItem,
    resetState,
  };
}

// Recalculate orders and assign level names based on actual tree position
function recalculateOrders(items: PlanItem[], levels: PlanLevel[]): PlanItem[] {
  const result: PlanItem[] = [];

  function processLevel(parentId: string | null, prefix: string, treeDepth: number) {
    const children = items.filter((i) => i.parentId === parentId);
    children.forEach((child, index) => {
      const order = prefix ? `${prefix}.${index + 1}` : `${index + 1}`;
      const levelName = levels.find((l) => l.depth === treeDepth)?.name || `Level ${treeDepth}`;
      result.push({ 
        ...child, 
        order, 
        levelDepth: treeDepth, 
        levelName 
      });
      processLevel(child.id, order, treeDepth + 1);
    });
  }

  processLevel(null, '', 1);
  return result;
}
