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

// Collect all item names (lowercased) from nested tree into a Set
function collectItemNameSet(items: unknown[]): Set<string> {
  const names = new Set<string>();
  for (const item of items) {
    const i = item as { name?: string; children?: unknown[] };
    if (i.name) names.add(i.name.toLowerCase().trim());
    if (i.children?.length) {
      for (const n of collectItemNameSet(i.children)) names.add(n);
    }
  }
  return names;
}


interface AuditFindings {
  missingItems?: { sourceText: string }[];
  mergedItems?: { extractedItemName: string }[];
  rephrasedItems?: { extractedItemId?: string; extractedName: string }[];
  duplicateItems?: { item1Name: string; item1Level?: string; item2Name: string; item2Level?: string; recommendation: string }[];
  extraItems?: { extractedItemName: string; reason: string }[];
  auditSummary?: Record<string, number>;
}

interface ValidationResult {
  correctedItems: unknown[];
  corrections: { itemId: string; type: string; description: string }[];
  detectedLevels?: { depth: number; name: string }[];
}

// Check if a correction is just a user-level override (renaming to match user-defined plan levels)
function isUserOverrideCorrection(correction: { type: string; description?: string }): boolean {
  const desc = (correction.description || "").toLowerCase();
  const type = correction.type.toLowerCase();
  // Level name changes to match user-defined structure
  if (type === "relevel" || type === "level_changed") {
    if (/match|user[- ]defined|plan structure|to match|mapped to/.test(desc)) return true;
  }
  // Renamed only to match user terminology
  if (type === "renamed" && /match|user[- ]defined|plan structure|to match|mapped to/.test(desc)) return true;
  // Reordering to match user-defined hierarchy (not structural)
  if ((type === "reordered" || type === "moved") && /match|user[- ]defined|plan structure|to match/.test(desc)) return true;
  return false;
}

// Calculate confidence scores for each item using NAME-based matching
function calculateConfidence(
  correctedItems: unknown[],
  agent1NameSet: Set<string>,
  auditFindings: AuditFindings | null,
  corrections: { itemId: string; type: string; description?: string }[]
): void {
  // Collect rephrased item names from audit findings
  const rephrasedNames = new Set(
    (auditFindings?.rephrasedItems || [])
      .map(r => r.extractedName?.toLowerCase().trim())
      .filter(Boolean)
  );

  // Group corrections by item ID
  const correctionsByItem = new Map<string, typeof corrections>();
  for (const c of corrections) {
    if (!correctionsByItem.has(c.itemId)) correctionsByItem.set(c.itemId, []);
    correctionsByItem.get(c.itemId)!.push(c);
  }

  function processItems(items: unknown[]): void {
    for (const item of items) {
      const i = item as { id?: string; name?: string; confidence?: number; corrections?: string[]; children?: unknown[] };
      const id = i.id || "";
      const name = (i.name || "").toLowerCase().trim();
      const itemCorrections = correctionsByItem.get(id) || [];

      // Build tagged correction strings
      const correctionDescs: string[] = [];
      for (const c of itemCorrections) {
        const isOverride = isUserOverrideCorrection(c);
        const prefix = isOverride ? "[user-override]" : "[agent-correction]";
        const agent = (c as { agent?: string }).agent || "Agent 3";
        const desc = c.description || c.type;
        correctionDescs.push(`${prefix} ${agent}: ${desc}`);
      }
      i.corrections = correctionDescs;

      // Separate user-override from real agent corrections
      const agentCorrections = itemCorrections.filter(c => !isUserOverrideCorrection(c));

      // Default: 100. Only reduce based on actual issues.
      if (id.startsWith("new-")) {
        // Item was missing from Agent 1, added by pipeline
        i.confidence = 40;
      } else if (name && !agent1NameSet.has(name)) {
        // Name not found in Agent 1 output — truly unknown origin
        i.confidence = 20;
      } else if (rephrasedNames.has(name)) {
        // Was rephrased, corrected back
        i.confidence = 60;
      } else if (agentCorrections.length > 0) {
        // Has real structural corrections (not user-override)
        i.confidence = 80;
      } else {
        // No issues — all agents agree or only user-override corrections
        i.confidence = 100;
      }

      console.log(`[confidence] "${i.name}" | corrections=${itemCorrections.length} (agent=${agentCorrections.length}) | confidence=${i.confidence}`);

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

// Select a representative subset of images for the audit step (max 10)
// Strategy: take first 2 pages (likely overview/TOC), last page, and evenly space the rest
function selectAuditImages(images: string[]): string[] {
  if (images.length <= 10) return images;
  const selected: string[] = [];
  const indices = new Set<number>();

  // Always include first 2 pages (overview, TOC)
  indices.add(0);
  if (images.length > 1) indices.add(1);

  // Always include last page
  indices.add(images.length - 1);

  // Fill remaining slots evenly from the middle
  const remaining = 10 - indices.size;
  const middleStart = 2;
  const middleEnd = images.length - 2;
  if (middleEnd > middleStart && remaining > 0) {
    const step = (middleEnd - middleStart) / (remaining + 1);
    for (let i = 0; i < remaining; i++) {
      indices.add(Math.round(middleStart + step * (i + 1)));
    }
  }

  // Sort and collect
  const sortedIndices = [...indices].sort((a, b) => a - b);
  for (const idx of sortedIndices) {
    if (idx >= 0 && idx < images.length) selected.push(images[idx]);
  }

  return selected;
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

      console.log(`[process-plan] Step 1 vision: ${images.length} images in ${batches.length} batches`);

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
          batchLabel: `Step 1: Document Scan (Batch ${batchIdx + 1} of ${batches.length})`,
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
    const agent1NameSet = collectItemNameSet(agent1Data.items);
    console.log(`[process-plan] Step 1 complete: ${agent1ItemCount} items, ${agent1Data.detectedLevels.length} levels, ${agent1NameSet.size} unique names`);

    // ==============================
    // STEP 2: Completeness Audit
    // ==============================
    console.log("[process-plan] Starting Step 2 (completeness audit)");
    let auditFindings: AuditFindings | null = null;

    const sourceForAudit = documentText || "";
    const hasSourceText = sourceForAudit.length > 100;

    try {
      // Build audit payload — use text if available, otherwise send page images
      const auditPayload: Record<string, unknown> = {
        extractedItems: agent1Data.items,
        sessionId,
        organizationName,
        industry,
        planLevels,
      };

      if (hasSourceText) {
        auditPayload.sourceText = sourceForAudit;
        console.log("[process-plan] Step 2: text-based audit");
      } else if (useVision && pageImages) {
        // For vision path, send a subset of images (max 10 for efficiency)
        const images = pageImages as string[];
        const auditImages = images.length <= 10 ? images : selectAuditImages(images);
        auditPayload.pageImages = auditImages;
        console.log(`[process-plan] Step 2: vision-based audit with ${auditImages.length} of ${images.length} images`);
      }

      if (hasSourceText || (useVision && pageImages)) {
        const auditResult = await callEdgeFunction("audit-completeness", auditPayload);

        if (auditResult.ok && (auditResult.data as { success: boolean }).success) {
          auditFindings = (auditResult.data as { data: AuditFindings }).data;
          console.log("[process-plan] Step 2 complete:", JSON.stringify(auditFindings?.auditSummary || {}));
        } else {
          console.error("[process-plan] Step 2 failed (non-fatal):", JSON.stringify(auditResult.data));
        }
      } else {
        console.log("[process-plan] Step 2 skipped — no source text or images available");
      }
    } catch (err) {
      console.error("[process-plan] Step 2 exception:", err);
    }

    // ==============================
    // AGENT 3: Hierarchy Validation
    // ==============================
    console.log("[process-plan] Starting Step 3 (structure validation)");
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
        console.log("[process-plan] Step 3 complete:", validationResult.corrections?.length || 0, "corrections");
      } else {
        console.error("[process-plan] Step 3 failed (non-fatal). Status:", validateResult.status, "Response:", JSON.stringify(validateResult.data));
      }
    } catch (err) {
      console.error("[process-plan] Step 3 exception:", err);
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

    // Calculate confidence scores using name-based matching
    calculateConfidence(finalItems, agent1NameSet, auditFindings, corrections);

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
