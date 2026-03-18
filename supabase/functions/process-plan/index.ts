import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { ensureSession } from "../_shared/logging.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

interface PipelineProgress {
  agent: number;
  totalAgents: number;
  agentName: string;
  status: string;
}

async function callEdgeFunction(
  functionName: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const url = `${SUPABASE_URL}/functions/v1/${functionName}`;
  console.log(`[process-plan] Calling ${functionName}...`);
  const startTime = Date.now();

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const elapsed = Date.now() - startTime;
  const data = await response.json();
  console.log(`[process-plan] ${functionName} completed in ${elapsed}ms, ok=${response.ok}`);

  return { ok: response.ok, status: response.status, data };
}

// Count all items recursively
function countAllItems(items: unknown[]): number {
  let count = 0;
  for (const item of items) {
    count++;
    const i = item as { children?: unknown[] };
    if (i.children?.length) count += countAllItems(i.children);
  }
  return count;
}

// Collect all item IDs from nested tree
function collectItemIds(items: unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    const i = item as { id?: string; children?: unknown[] };
    if (i.id) ids.add(i.id);
    if (i.children?.length) {
      for (const id of collectItemIds(i.children)) ids.add(id);
    }
  }
  return ids;
}

// Collect item names for matching
function collectItemNames(items: unknown[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of items) {
    const i = item as { id?: string; name?: string; children?: unknown[] };
    if (i.id && i.name) map.set(i.id, i.name);
    if (i.children?.length) {
      for (const [k, v] of collectItemNames(i.children)) map.set(k, v);
    }
  }
  return map;
}

interface AuditFindings {
  missingItems?: { sourceText: string }[];
  mergedItems?: { extractedItemName: string }[];
  rephrasedItems?: { extractedItemId?: string; extractedName: string }[];
  auditSummary?: Record<string, number>;
}

interface ValidationResult {
  correctedItems: unknown[];
  corrections: { itemId: string; type: string; description: string }[];
  detectedLevels?: { depth: number; name: string }[];
}

// Calculate confidence scores for each item
function calculateConfidence(
  correctedItems: unknown[],
  agent1Ids: Set<string>,
  agent1Names: Map<string, string>,
  auditFindings: AuditFindings | null,
  corrections: { itemId: string; type: string }[]
): void {
  const rephrasedIds = new Set(
    (auditFindings?.rephrasedItems || [])
      .map(r => r.extractedItemId)
      .filter(Boolean)
  );

  const correctionMap = new Map<string, string[]>();
  for (const c of corrections) {
    if (!correctionMap.has(c.itemId)) correctionMap.set(c.itemId, []);
    correctionMap.get(c.itemId)!.push(c.type);
  }

  function processItems(items: unknown[]): void {
    for (const item of items) {
      const i = item as { id?: string; confidence?: number; corrections?: string[]; children?: unknown[] };
      const id = i.id || "";
      const itemCorrections = correctionMap.get(id) || [];

      // Build corrections strings
      const correctionDescs: string[] = [];
      for (const c of corrections.filter(x => x.itemId === id)) {
        correctionDescs.push(`${(c as { agent?: string }).agent || "Agent 3"}: ${(c as { description?: string }).description || c.type}`);
      }
      i.corrections = correctionDescs;

      // Calculate confidence
      if (id.startsWith("new-")) {
        // Item was missing from Agent 1, added by Agent 3
        i.confidence = 40;
      } else if (!agent1Ids.has(id)) {
        // Unknown origin — Agent 3's best guess
        i.confidence = 20;
      } else if (rephrasedIds.has(id)) {
        // Was rephrased, corrected by Agent 3
        i.confidence = 60;
      } else if (itemCorrections.length > 0) {
        // Existed but had minor corrections
        i.confidence = 80;
      } else {
        // All 3 agents agree
        i.confidence = 100;
      }

      if (i.children?.length) processItems(i.children);
    }
  }

  processItems(correctedItems);
}

// Batch page images into groups of N
function batchImages(images: string[], batchSize: number): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < images.length; i += batchSize) {
    batches.push(images.slice(i, i + batchSize));
  }
  return batches;
}

// Merge vision batch results, deduplicating by name
function mergeVisionBatchResults(
  existing: unknown[],
  newItems: unknown[]
): unknown[] {
  if (existing.length === 0) return newItems;
  const names = new Set<string>();
  function collectNames(items: unknown[]) {
    for (const item of items) {
      const i = item as { name?: string; children?: unknown[] };
      if (i.name) names.add(i.name.toLowerCase());
      if (i.children?.length) collectNames(i.children);
    }
  }
  collectNames(existing);
  const unique = newItems.filter((item) => {
    const i = item as { name?: string };
    if (!i.name) return false;
    const lower = i.name.toLowerCase();
    if (names.has(lower)) return false;
    names.add(lower);
    return true;
  });
  return [...existing, ...unique];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      documentText,
      organizationName,
      industry,
      documentHints,
      sessionId: incomingSessionId,
      pageImages,
      planLevels,
      pageRange,
    } = body;

    if (!documentText && !pageImages) {
      return new Response(JSON.stringify({ success: false, error: "documentText or pageImages required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sessionId = await ensureSession(incomingSessionId);
    console.log("[process-plan] Pipeline starting, sessionId:", sessionId);

    // ==============================
    // AGENT 1: Extraction
    // ==============================
    let agent1Data: { items: unknown[]; detectedLevels: { depth: number; name: string }[] } | null = null;
    let extractionMethod = "text";
    let agent1Error: string | null = null;

    const useVision = !!pageImages && (!documentText || documentText.trim().length < 50);

    if (useVision) {
      extractionMethod = "vision";
      // Batch vision images in groups of 5, same as frontend used to do
      const images = pageImages as string[];
      const batches = batchImages(images, 5);
      let allItems: unknown[] = [];
      let detectedLevels: { depth: number; name: string }[] = [];
      let previousContext = "";

      console.log(`[process-plan] Agent 1 vision: ${images.length} images in ${batches.length} batches`);

      for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
        const batch = batches[batchIdx];

        // Rate limit between batches
        if (batchIdx > 0) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        }

        const result = await callEdgeFunction("extract-plan-vision", {
          pageImages: batch,
          previousContext,
          organizationName,
          industry,
          documentHints,
          planLevels,
          pageRange,
          sessionId,
        });

        if (result.ok && (result.data as { success: boolean }).success) {
          const d = (result.data as { data: { items?: unknown[]; detectedLevels?: { depth: number; name: string }[]; documentTerminology?: { columnHierarchy?: string[] } }; contextSummary?: string }).data;

          if (d.items?.length) {
            allItems = mergeVisionBatchResults(allItems, d.items);
          }

          // Capture levels from first batch or first non-empty
          if (batchIdx === 0 && d.documentTerminology?.columnHierarchy?.length) {
            detectedLevels = d.documentTerminology.columnHierarchy.map(
              (name: string, idx: number) => ({ depth: idx + 1, name })
            );
          } else if (d.detectedLevels?.length && detectedLevels.length === 0) {
            detectedLevels = d.detectedLevels;
          }

          // Carry context forward for next batch
          const ctx = (result.data as { contextSummary?: string }).contextSummary;
          if (ctx) previousContext = ctx;
        } else {
          console.warn(`[process-plan] Vision batch ${batchIdx + 1} failed:`, (result.data as { error?: string }).error);
        }
      }

      if (allItems.length > 0) {
        agent1Data = {
          items: allItems,
          detectedLevels: detectedLevels.length > 0 ? detectedLevels : [
            { depth: 1, name: "Strategic Priority" },
            { depth: 2, name: "Objective" },
            { depth: 3, name: "Goal" },
            { depth: 4, name: "Strategy" },
            { depth: 5, name: "KPI" },
          ],
        };
      } else {
        agent1Error = "Vision extraction produced no items across all batches";
      }
    } else {
      const result = await callEdgeFunction("extract-plan-items", {
        documentText,
        organizationName,
        industry,
        documentHints,
        planLevels,
        pageRange,
        sessionId,
      });
      if (result.ok && (result.data as { success: boolean }).success) {
        const d = (result.data as { data: { items: unknown[]; detectedLevels: { depth: number; name: string }[] } }).data;
        agent1Data = { items: d.items || [], detectedLevels: d.detectedLevels || [] };
      } else {
        agent1Error = (result.data as { error?: string }).error || "Text extraction failed";
      }
    }

    if (!agent1Data || agent1Data.items.length === 0) {
      console.error("[process-plan] Agent 1 failed:", agent1Error);
      return new Response(JSON.stringify({
        success: false,
        error: agent1Error || "Extraction produced no items",
        pipelineStep: "agent1",
      }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const agent1ItemCount = countAllItems(agent1Data.items);
    const agent1Ids = collectItemIds(agent1Data.items);
    const agent1Names = collectItemNames(agent1Data.items);
    console.log(`[process-plan] Agent 1 complete: ${agent1ItemCount} items, ${agent1Data.detectedLevels.length} levels`);

    // ==============================
    // AGENT 2: Completeness Audit
    // ==============================
    console.log("[process-plan] Starting Agent 2 (completeness audit)");
    let auditFindings: AuditFindings | null = null;

    // Only run audit if we have source text
    const sourceForAudit = documentText || "";
    if (sourceForAudit.length > 100) {
      try {
        const auditResult = await callEdgeFunction("audit-completeness", {
          sourceText: sourceForAudit,
          extractedItems: agent1Data.items,
          sessionId,
          organizationName,
          industry,
          planLevels,
        });

        if (auditResult.ok && (auditResult.data as { success: boolean }).success) {
          auditFindings = (auditResult.data as { data: AuditFindings }).data;
          console.log("[process-plan] Agent 2 complete:", JSON.stringify(auditFindings?.auditSummary || {}));
        } else {
          console.error("[process-plan] Agent 2 failed (non-fatal):", JSON.stringify(auditResult.data));
        }
      } catch (err) {
        console.error("[process-plan] Agent 2 exception:", err);
      }
    } else {
      console.log("[process-plan] Skipping Agent 2 — vision-only extraction, no source text available");
    }

    // ==============================
    // AGENT 3: Hierarchy Validation
    // ==============================
    console.log("[process-plan] Starting Agent 3 (hierarchy validation)");
    let validationResult: ValidationResult | null = null;

    try {
      const validateResult = await callEdgeFunction("validate-hierarchy", {
        sourceText: sourceForAudit,
        extractedItems: agent1Data.items,
        auditFindings,
        detectedLevels: agent1Data.detectedLevels,
        sessionId,
        organizationName,
        industry,
        planLevels,
      });

      if (validateResult.ok && (validateResult.data as { success: boolean }).success) {
        validationResult = (validateResult.data as { data: ValidationResult }).data;
        console.log("[process-plan] Agent 3 complete:", validationResult.corrections?.length || 0, "corrections");
      } else {
        console.error("[process-plan] Agent 3 failed (non-fatal). Status:", validateResult.status, "Response:", JSON.stringify(validateResult.data));
      }
    } catch (err) {
      console.error("[process-plan] Agent 3 exception:", err);
    }

    // ==============================
    // MERGE & CONFIDENCE SCORING
    // ==============================
    let finalItems: unknown[];
    let finalLevels: { depth: number; name: string }[];
    let corrections: { itemId: string; type: string; description: string }[] = [];

    if (validationResult?.correctedItems?.length > 0) {
      finalItems = validationResult.correctedItems;
      finalLevels = validationResult.detectedLevels?.length
        ? validationResult.detectedLevels
        : agent1Data.detectedLevels;
      corrections = validationResult.corrections || [];
    } else {
      // Fallback to Agent 1 output
      finalItems = agent1Data.items;
      finalLevels = agent1Data.detectedLevels;
    }

    // Calculate confidence scores
    calculateConfidence(finalItems, agent1Ids, agent1Names, auditFindings, corrections);

    // Calculate session confidence
    const allConfidences: number[] = [];
    function gatherConfidences(items: unknown[]) {
      for (const item of items) {
        const i = item as { confidence?: number; children?: unknown[] };
        if (typeof i.confidence === "number") allConfidences.push(i.confidence);
        if (i.children?.length) gatherConfidences(i.children);
      }
    }
    gatherConfidences(finalItems);
    const sessionConfidence = allConfidences.length > 0
      ? Math.round(allConfidences.reduce((a, b) => a + b, 0) / allConfidences.length)
      : 0;

    const finalItemCount = countAllItems(finalItems);
    console.log(`[process-plan] Pipeline complete: ${finalItemCount} items, ${corrections.length} corrections, confidence=${sessionConfidence}%`);

    return new Response(JSON.stringify({
      success: true,
      data: {
        items: finalItems,
        detectedLevels: finalLevels,
      },
      totalItems: finalItemCount,
      corrections,
      sessionConfidence,
      auditSummary: auditFindings?.auditSummary || null,
      extractionMethod,
      pipelineComplete: true,
      sessionId,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[process-plan] Pipeline error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: "Pipeline processing failed. Please try again.",
    }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
