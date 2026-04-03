import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { ensureSession, logApiCall } from "../_shared/logging.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function getServiceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

// ==============================
// SELF-CHAINING HELPERS
// ==============================
const MAX_EXECUTION_MS = 120_000; // 120s — leave 30s buffer before 150s timeout

function shouldChain(startTime: number): boolean {
  return (Date.now() - startTime) > MAX_EXECUTION_MS;
}

async function dispatchChain(sessionId: string): Promise<void> {
  const url = `${SUPABASE_URL}/functions/v1/process-plan`;
  const payload = {
    resume_session_id: sessionId,
    isChainedResume: true,
  };
  fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(payload),
  }).catch(err => console.error("[process-plan] Chain dispatch failed:", err));
  console.log(`[process-plan] Chained next invocation for session ${sessionId}`);
}

async function updateSessionProgress(sessionId: string, updates: Record<string, unknown>): Promise<void> {
  try {
    const client = getServiceClient();
    const { error } = await client.from("processing_sessions").update(updates).eq("id", sessionId);
    if (error) console.error("[process-plan] Failed to update session progress:", error.message);
  } catch (e) {
    console.error("[process-plan] updateSessionProgress exception:", e);
  }
}
async function checkOwnership(sessionId: string, myRunId: string): Promise<boolean> {
  try {
    const client = getServiceClient();
    const { data } = await client.from("processing_sessions")
      .select("pipeline_run_id").eq("id", sessionId).single();
    const currentId = (data as Record<string, unknown>)?.pipeline_run_id as string | null;
    if (currentId && currentId !== myRunId) {
      console.warn(`[process-plan] Pipeline run ${myRunId} superseded by ${currentId}, stopping gracefully`);
      return false;
    }
    console.log(`[process-plan] Ownership check passed for run ${myRunId}`);
    return true;
  } catch (e) {
    console.error("[process-plan] checkOwnership exception:", e);
    // On error checking, assume we still own it to avoid silent stops
    return true;
  }
}

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

// Split text into chunks at paragraph boundaries (~25K chars each)
const TEXT_CHUNK_SIZE = 25000;
function splitDocumentIntoChunks(text: string, maxChunkSize: number = TEXT_CHUNK_SIZE): string[] {
  if (text.length <= maxChunkSize) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxChunkSize) {
      chunks.push(remaining);
      break;
    }

    let splitAt = maxChunkSize;
    const lastDoubleNewline = remaining.lastIndexOf('\n\n', maxChunkSize);
    if (lastDoubleNewline > maxChunkSize * 0.5) {
      splitAt = lastDoubleNewline + 2;
    } else {
      const lastNewline = remaining.lastIndexOf('\n', maxChunkSize);
      if (lastNewline > maxChunkSize * 0.5) {
        splitAt = lastNewline + 1;
      }
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }

  return chunks;
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
  rephrasedItems?: { extractedItemId?: string; extractedName: string; originalText?: string }[];
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
  if (type === "relevel" || type === "level_changed") {
    if (/match|user[- ]defined|plan structure|to match|mapped to/.test(desc)) return true;
  }
  if (type === "renamed" && /match|user[- ]defined|plan structure|to match|mapped to/.test(desc)) return true;
  if ((type === "reordered" || type === "moved") && /match|user[- ]defined|plan structure|to match/.test(desc)) return true;
  return false;
}

function isCapitalizationOnlyChange(a: string, b: string): boolean {
  return a.toLowerCase().trim() === b.toLowerCase().trim() && a.trim() !== b.trim();
}

// Calculate confidence scores for each item using NAME-based matching
function calculateConfidence(
  correctedItems: unknown[],
  agent1NameSet: Set<string>,
  auditFindings: AuditFindings | null,
  corrections: { itemId: string; type: string; description?: string }[]
): void {
  const rephrasedNames = new Set(
    (auditFindings?.rephrasedItems || [])
      .map(r => r.extractedName?.toLowerCase().trim())
      .filter(Boolean)
  );

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

      const correctionDescs: string[] = [];
      const capOnlyIds = new Set<number>();
      for (let ci = 0; ci < itemCorrections.length; ci++) {
        const c = itemCorrections[ci];
        const cAny = c as { agent?: string; originalName?: string; correctedName?: string };
        const isCapOnly = (c.type === 'renamed' || /rephras/i.test(c.description || ''))
          && cAny.originalName && cAny.correctedName
          && isCapitalizationOnlyChange(cAny.originalName, cAny.correctedName);

        if (isCapOnly) {
          capOnlyIds.add(ci);
          correctionDescs.push(`[user-override] Name capitalization normalized`);
        } else {
          const isOverride = isUserOverrideCorrection(c);
          const prefix = isOverride ? "[user-override]" : "[agent-correction]";
          const agent = cAny.agent || "Agent 3";
          const desc = c.description || c.type;
          correctionDescs.push(`${prefix} ${agent}: ${desc}`);
        }
      }
      i.corrections = correctionDescs;

      const agentCorrections = itemCorrections.filter((c, ci) => !isUserOverrideCorrection(c) && !capOnlyIds.has(ci));

      if (id.startsWith("new-")) {
        i.confidence = 40;
      } else if (name && !agent1NameSet.has(name)) {
        i.confidence = 20;
      } else if (rephrasedNames.has(name)) {
        i.confidence = 60;
      } else if (agentCorrections.length > 0) {
        i.confidence = 80;
      } else {
        i.confidence = 100;
      }

      console.log(`[confidence] "${i.name}" | corrections=${itemCorrections.length} (agent=${agentCorrections.length}) | confidence=${i.confidence}`);

      if (i.children?.length) processItems(i.children);
    }
  }

  processItems(correctedItems);
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

function enforceMaxDepth(
  items: unknown[],
  maxDepth: number,
  planLevels: { depth: number; name: string }[],
  currentDepth = 1
): void {
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as { levelType?: string; levelName?: string; children?: unknown[]; name?: string };
    const children = item.children || [];

    for (let c = children.length - 1; c >= 0; c--) {
      const child = children[c] as { name?: string; children?: unknown[] };
      if (item.name && child.name && normalizeName(item.name) === normalizeName(child.name)) {
        console.log(`[enforceMaxDepth] Merging duplicate child "${child.name}" into parent "${item.name}"`);
        const grandchildren = (child.children || []) as unknown[];
        children.splice(c, 1, ...grandchildren);
      }
    }

    if (currentDepth > maxDepth) {
      const deepestLevel = planLevels[maxDepth - 1];
      if (deepestLevel) {
        item.levelType = deepestLevel.name;
        item.levelName = deepestLevel.name;
      }
    }

    if (children.length > 0) {
      enforceMaxDepth(children, maxDepth, planLevels, currentDepth + 1);
    }
  }
}

/** Apply rephrased corrections from audit: fix item names back to original text and record corrections */
function applyRephrasedCorrections(
  items: unknown[],
  rephrasedItems: { extractedName: string; originalText?: string }[],
  corrections: { itemId: string; type: string; description: string }[]
): void {
  const rephraseMap = new Map<string, string>();
  for (const r of rephrasedItems) {
    if (r.extractedName && r.originalText) {
      rephraseMap.set(r.extractedName.toLowerCase().trim(), r.originalText);
    }
  }
  if (rephraseMap.size === 0) return;

  function walk(list: unknown[]) {
    for (const item of list) {
      const i = item as { id?: string; name?: string; children?: unknown[] };
      const key = (i.name || "").toLowerCase().trim();
      if (rephraseMap.has(key)) {
        const original = rephraseMap.get(key)!;
        corrections.push({
          itemId: i.id || "unknown",
          type: "renamed",
          description: `Completeness Audit: Rephrased during extraction. Original: "${original}"`,
        });
        i.name = original;
      }
      if (i.children?.length) walk(i.children);
    }
  }
  walk(items);
}

// ==============================
// FUZZY DEDUPLICATION
// ==============================
function normalizeItemName(name: string): string {
  return (name || "").toLowerCase().trim().replace(/\s+/g, " ");
}

function wordSet(name: string): Set<string> {
  return new Set(normalizeItemName(name).split(" ").filter(w => w.length > 3));
}

function wordOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) {
    if (b.has(w)) shared++;
  }
  const total = Math.max(a.size, b.size);
  return total > 0 ? shared / total : 0;
}

function isDuplicate(nameA: string, nameB: string, parentA?: string | null, parentB?: string | null): { match: boolean; reason: string } {
  // ALL conditions require same parent (or both null/empty)
  const sameParent = (parentA || null) === (parentB || null);
  if (!sameParent) return { match: false, reason: "different_parent" };

  const normA = normalizeItemName(nameA);
  const normB = normalizeItemName(nameB);
  if (normA === normB) return { match: true, reason: "exact_match" };
  // Prefix match (first 40 chars)
  const prefix = 40;
  if (normA.length >= prefix && normB.length >= prefix && normA.substring(0, prefix) === normB.substring(0, prefix)) return { match: true, reason: "starts_with_40" };
  const overlap = wordOverlap(wordSet(nameA), wordSet(nameB));
  if (overlap >= 0.70) return { match: true, reason: `word_overlap_${Math.round(overlap * 100)}%` };
  return { match: false, reason: "" };
}

interface DedupRemovedDetail {
  removed_name: string;
  removed_page: number;
  removed_parent: string;
  removed_item: Record<string, unknown>;
  kept_name: string;
  kept_page: number;
  kept_parent: string;
  match_reason: string;
}

interface DedupSkippedDetail {
  name: string;
  parentA: string;
  parentB: string;
}

interface DedupResult {
  items: unknown[];
  removedDetails: DedupRemovedDetail[];
  skippedDetails: DedupSkippedDetail[];
}

function deduplicateItems(items: unknown[]): DedupResult {
  // Group by level
  const byLevel = new Map<string, unknown[]>();
  for (const item of items) {
    const i = item as { level?: string; levelType?: string };
    const lvl = (i.level || i.levelType || "unknown").toLowerCase();
    if (!byLevel.has(lvl)) byLevel.set(lvl, []);
    byLevel.get(lvl)!.push(item);
  }

  const removed = new Set<number>();
  const removedDetails: DedupRemovedDetail[] = [];
  const skippedDetails: DedupSkippedDetail[] = [];
  const itemsArr = [...items];

  for (const [, group] of byLevel) {
    for (let a = 0; a < group.length; a++) {
      for (let b = a + 1; b < group.length; b++) {
        const itemA = group[a] as { name?: string; source_page?: number; parent_name?: string };
        const itemB = group[b] as { name?: string; source_page?: number; parent_name?: string };
        if (!itemA.name || !itemB.name) continue;

        const dupCheck = isDuplicate(itemA.name, itemB.name, itemA.parent_name, itemB.parent_name);

        // Track skipped: names match but different parents
        if (!dupCheck.match && dupCheck.reason === "different_parent") {
          const normA = normalizeItemName(itemA.name);
          const normB = normalizeItemName(itemB.name);
          const namesMatch = normA === normB ||
            (normA.length >= 40 && normB.length >= 40 && normA.substring(0, 40) === normB.substring(0, 40)) ||
            wordOverlap(wordSet(itemA.name), wordSet(itemB.name)) >= 0.70;
          if (namesMatch) {
            skippedDetails.push({
              name: itemA.name,
              parentA: itemA.parent_name || "(none)",
              parentB: itemB.parent_name || "(none)",
            });
            console.log(`[process-plan] Dedup skipped: '${itemA.name}' under '${itemA.parent_name || "(none)"}' vs '${itemB.parent_name || "(none)"}' — same name but different parents, kept both`);
          }
          continue;
        }

        if (!dupCheck.match) continue;

        const idxA = itemsArr.indexOf(group[a]);
        const idxB = itemsArr.indexOf(group[b]);
        if (removed.has(idxA) || removed.has(idxB)) continue;

        // Simple rule: prefer higher source_page (detail pages), tie-break by longer name
        let keepIdx = idxA, discardIdx = idxB;
        const pageA = itemA.source_page || 0;
        const pageB = itemB.source_page || 0;
        if (pageB > pageA || (pageB === pageA && (itemB.name?.length || 0) > (itemA.name?.length || 0))) {
          keepIdx = idxB; discardIdx = idxA;
        }

        // Preserve parent_name from discarded if keeper lacks one
        const keeper = itemsArr[keepIdx] as { parent_name?: string; name?: string; source_page?: number };
        const discarded = itemsArr[discardIdx] as { parent_name?: string; name?: string; source_page?: number };
        if (!keeper.parent_name && discarded.parent_name) {
          keeper.parent_name = discarded.parent_name;
        }

        removedDetails.push({
          removed_name: discarded.name || "",
          removed_page: discarded.source_page || 0,
          removed_parent: (discarded as Record<string, unknown>).parent_name as string || "",
          removed_item: { ...(itemsArr[discardIdx] as Record<string, unknown>) },
          kept_name: keeper.name || "",
          kept_page: keeper.source_page || 0,
          kept_parent: (keeper as Record<string, unknown>).parent_name as string || "",
          match_reason: dupCheck.reason,
        });

        console.log(`[process-plan] Dedup: removed '${discarded.name}' (page ${discarded.source_page || '?'}), kept '${keeper.name}' (page ${keeper.source_page || '?'}) [${dupCheck.reason}]`);
        removed.add(discardIdx);
      }
    }
  }

  const result = itemsArr.filter((_, idx) => !removed.has(idx));
  if (removed.size > 0) {
    console.log(`[process-plan] Dedup complete: ${removed.size} duplicates removed, ${skippedDetails.length} skipped (different parents), ${result.length} items remaining`);
  }
  return { items: result, removedDetails, skippedDetails };
}

// ==============================
// PAGE RANGE PARSING
// ==============================
function parsePageRange(pageRangeStr: string, maxPage: number): Set<number> {
  const pages = new Set<number>();
  if (!pageRangeStr || !pageRangeStr.trim()) return pages;
  const parts = pageRangeStr.split(",").map(p => p.trim()).filter(Boolean);
  for (const part of parts) {
    const rangeMatch = part.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      for (let p = start; p <= end; p++) {
        if (p >= 1 && p <= maxPage) pages.add(p);
      }
    } else {
      const num = parseInt(part, 10);
      if (!isNaN(num) && num >= 1 && num <= maxPage) pages.add(num);
    }
  }
  return pages;
}

function batchImages(images: string[], batchSize: number): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < images.length; i += batchSize) {
    batches.push(images.slice(i, i + batchSize));
  }
  return batches;
}

function selectAuditImages(images: string[]): string[] {
  if (images.length <= 10) return images;
  const selected: string[] = [];
  const indices = new Set<number>();

  indices.add(0);
  if (images.length > 1) indices.add(1);
  indices.add(images.length - 1);

  const remaining = 10 - indices.size;
  const middleStart = 2;
  const middleEnd = images.length - 2;
  if (middleEnd > middleStart && remaining > 0) {
    const step = (middleEnd - middleStart) / (remaining + 1);
    for (let i = 0; i < remaining; i++) {
      indices.add(Math.round(middleStart + step * (i + 1)));
    }
  }

  const sortedIndices = [...indices].sort((a, b) => a - b);
  for (const idx of sortedIndices) {
    if (idx >= 0 && idx < images.length) selected.push(images[idx]);
  }

  return selected;
}

function flattenItems(items: unknown[]): unknown[] {
  const flat: unknown[] = [];
  for (const item of items) {
    const i = item as Record<string, unknown>;
    const { children, ...rest } = i;
    flat.push(rest);
    if (Array.isArray(children) && children.length > 0) {
      flat.push(...flattenItems(children as unknown[]));
    }
  }
  return flat;
}

function mergeVisionBatchResults(
  existing: unknown[],
  newItems: unknown[]
): unknown[] {
  // Flatten both inputs to ensure no nested children are lost
  const flatExisting = flattenItems(existing);
  const flatNew = flattenItems(newItems);
  if (flatExisting.length === 0) return flatNew;
  const names = new Set<string>();
  for (const item of flatExisting) {
    const i = item as { name?: string };
    if (i.name) names.add(i.name.toLowerCase());
  }
  const unique = flatNew.filter((item) => {
    const i = item as { name?: string };
    if (!i.name) return false;
    const lower = i.name.toLowerCase();
    if (names.has(lower)) return false;
    names.add(lower);
    return true;
  });
  return [...flatExisting, ...unique];
}

// ==============================
// IMAGE PERSISTENCE TO STORAGE
// ==============================

/** Upload filtered page images to storage for resume capability */
async function persistPageImages(
  sessionId: string,
  images: string[],
  pageIndexMap: number[]
): Promise<void> {
  const client = getServiceClient();
  console.log(`[process-plan] Persisting ${images.length} page images to storage for session ${sessionId}`);

  const uploadPromises = images.map(async (dataUrl, idx) => {
    try {
      // Convert data URL to Uint8Array
      const base64Data = dataUrl.split(",")[1];
      if (!base64Data) return;
      const binaryStr = atob(base64Data);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      const filePath = `${sessionId}/${idx}.jpg`;
      const { error } = await client.storage.from("page-images").upload(filePath, bytes, {
        contentType: "image/jpeg",
        upsert: true,
      });
      if (error) {
        console.error(`[process-plan] Failed to upload page image ${idx}:`, error.message);
      }
    } catch (e) {
      console.error(`[process-plan] Exception uploading page image ${idx}:`, e);
    }
  });

  await Promise.all(uploadPromises);
  console.log(`[process-plan] Persisted ${images.length} page images to storage for session ${sessionId}`);
}

/** Download page images from storage for resume */
async function loadPageImages(sessionId: string, count: number): Promise<string[]> {
  const client = getServiceClient();
  const images: string[] = [];

  console.log(`[process-plan] Loading ${count} page images from storage for session ${sessionId}`);

  for (let idx = 0; idx < count; idx++) {
    try {
      const filePath = `${sessionId}/${idx}.jpg`;
      const { data, error } = await client.storage.from("page-images").download(filePath);
      if (error || !data) {
        console.error(`[process-plan] Failed to download page image ${idx}:`, error?.message);
        continue;
      }
      const arrayBuffer = await data.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      images.push(`data:image/jpeg;base64,${base64}`);
    } catch (e) {
      console.error(`[process-plan] Exception downloading page image ${idx}:`, e);
    }
  }

  console.log(`[process-plan] Loaded ${images.length} of ${count} page images from storage`);
  return images;
}

/** Delete stored page images after pipeline completes */
async function cleanupPageImages(sessionId: string): Promise<void> {
  try {
    const client = getServiceClient();
    const { data: files, error: listError } = await client.storage
      .from("page-images")
      .list(sessionId);

    if (listError || !files || files.length === 0) return;

    const filePaths = files.map(f => `${sessionId}/${f.name}`);
    const { error: removeError } = await client.storage
      .from("page-images")
      .remove(filePaths);

    if (removeError) {
      console.error("[process-plan] Cleanup page images error:", removeError.message);
    } else {
      console.log(`[process-plan] Cleaned up ${filePaths.length} stored page images for session ${sessionId}`);
    }
  } catch (e) {
    console.error("[process-plan] Cleanup page images exception:", e);
  }
}

// ==============================
// The actual pipeline logic, runs in background after early return
// ==============================
async function runPipeline(sessionId: string, body: Record<string, unknown>): Promise<void> {
  const startTime = Date.now();
  const pipelineRunId = crypto.randomUUID();
  console.log(`[process-plan] Starting pipeline run ${pipelineRunId} for session ${sessionId}`);
  await updateSessionProgress(sessionId, { pipeline_run_id: pipelineRunId });

  try {
    const {
      documentText,
      organizationName,
      industry,
      documentHints,
      pageImages,
      planLevels,
      pageRange,
      classificationResult: preClassification,
    } = body;

    const hasDocumentText = !!documentText && (documentText as string).trim().length > 50;
    let useVision = !!pageImages && Array.isArray(pageImages) && (pageImages as string[]).length > 0;

    // ==============================
    // AGENT 0: Document Classification
    // ==============================
    let classification: Record<string, unknown> | null = null;
    let extractionMode: "standard" | "table" | "presentation" = "standard";

    if (preClassification && typeof preClassification === "object") {
      // Use classification from quick scan — skip Agent 0
      classification = preClassification as Record<string, unknown>;
      console.log("[process-plan] Using pre-computed classification, skipping Agent 0. document_type:", classification.document_type);

      const docType = classification.document_type as string;
      const tableStructure = classification.table_structure;
      if (docType === "tabular" && tableStructure) {
        extractionMode = "table";
      } else if (docType === "presentation" || docType === "mixed") {
        extractionMode = "presentation";
      }
      console.log("[process-plan] Extraction mode:", extractionMode);

      await updateSessionProgress(sessionId, {
        document_type: classification.document_type || null,
        classification_result: classification,
      });
    } else if (useVision) {
      console.log("[process-plan] Starting Step 0 (document classification)");
      await updateSessionProgress(sessionId, { current_step: "classifying" });

      try {
        const classifyResult = await callEdgeFunction("classify-document", {
          pageImages,
          orgName: organizationName || "",
          industry: industry || "",
          userPlanLevels: planLevels || null,
          pageRange: pageRange || null,
          additionalNotes: documentHints || null,
          sessionId,
        });

        if (classifyResult.ok && (classifyResult.data as { success: boolean }).success) {
          classification = (classifyResult.data as { classification: Record<string, unknown> }).classification;
          console.log("[process-plan] Step 0 complete, document_type:", classification?.document_type);

          const docType = classification?.document_type as string;
          const tableStructure = classification?.table_structure;
          if (docType === "tabular" && tableStructure) {
            extractionMode = "table";
          } else if (docType === "presentation" || docType === "mixed") {
            extractionMode = "presentation";
          }
          console.log("[process-plan] Extraction mode:", extractionMode);

          await updateSessionProgress(sessionId, {
            document_type: classification?.document_type || null,
            classification_result: classification,
          });
        } else {
          console.warn("[process-plan] Step 0 failed (non-fatal):", JSON.stringify(classifyResult.data));
        }
      } catch (err) {
        console.error("[process-plan] Step 0 exception (non-fatal):", err);
      }
    }

    // ==============================
    // AGENT 1: Extraction
    // ==============================
    let extractionMethod: "vision" | "text" = "text";

    // TEXT_HEAVY OVERRIDE: Use text extraction instead of vision
    if (useVision && classification?.document_type === "text_heavy" && hasDocumentText) {
      console.log("[process-plan] Document classified as text_heavy — using text extraction instead of vision");
      useVision = false;
      extractionMethod = "text";

      await logApiCall({
        session_id: sessionId,
        edge_function: "process-plan",
        step_label: "Text_heavy override: switching from vision to text extraction",
        status: "success",
      });
    }

    await updateSessionProgress(sessionId, { current_step: "extracting" });

    let agent1Data: { items: unknown[]; detectedLevels: { depth: number; name: string }[] } | null = null;
    let agent1Error: string | null = null;

    if (useVision) {
      extractionMethod = "vision";
      let images = pageImages as string[];

      // Use Agent 0's page_annotations to filter pages (all modes)
      const pageAnnotationsArr = classification?.page_annotations as Array<{ page?: number; contains_plan_items?: boolean; notes?: string }> | undefined;
      if (Array.isArray(pageAnnotationsArr) && pageAnnotationsArr.length > 0) {
        const planPages = pageAnnotationsArr
          .filter(a => a.contains_plan_items === true && typeof a.page === 'number')
          .map(a => a.page!)
          .filter(p => p >= 1 && p <= images.length)
          .sort((a, b) => a - b);

        if (planPages.length > 0) {
          // Apply page buffer for classification safety
          const safeToSkip = new Set(['cover', 'toc', 'vision_mission', 'blank', 'appendix']);
          const planPageSet = new Set(planPages);
          const bufferedPages: number[] = [];

          // Buffer 1: include the page immediately before the first plan page
          const firstPlanPage = Math.min(...planPages);
          if (firstPlanPage > 1) {
            const prevAnnotation = pageAnnotationsArr.find(a => a.page === firstPlanPage - 1);
            const prevClassification = (prevAnnotation as Record<string, unknown>)?.classification as string | undefined;
            if (!prevClassification || !safeToSkip.has(prevClassification)) {
              planPageSet.add(firstPlanPage - 1);
              bufferedPages.push(firstPlanPage - 1);
            }
          }

          // Buffer 2: fill gaps between consecutive plan pages
          const sortedPlanPages = [...planPages].sort((a, b) => a - b);
          for (let i = 0; i < sortedPlanPages.length - 1; i++) {
            const current = sortedPlanPages[i];
            const next = sortedPlanPages[i + 1];
            for (let p = current + 1; p < next; p++) {
              if (!planPageSet.has(p)) {
                const annotation = pageAnnotationsArr.find(a => a.page === p);
                const cls = (annotation as Record<string, unknown>)?.classification as string | undefined;
                if (!cls || !safeToSkip.has(cls)) {
                  planPageSet.add(p);
                  bufferedPages.push(p);
                }
              }
            }
          }

          const finalFilteredPages = [...planPageSet].filter(p => p >= 1 && p <= images.length).sort((a, b) => a - b);
          if (bufferedPages.length > 0) {
            console.log(`[process-plan] Page buffer: added pages [${bufferedPages.sort((a, b) => a - b).join(", ")}] to filtered set.`);
          }
          const filtered = finalFilteredPages.map(p => images[p - 1]);
          console.log(`[process-plan] Agent 0 recommended pages [${planPages.join(", ")}]. Final extraction pages: [${finalFilteredPages.join(", ")}] (${filtered.length} of ${images.length} pages).`);
          images = filtered;
        } else {
          console.log(`[process-plan] Agent 0 page_annotations had no contains_plan_items pages, sending all ${images.length} pages`);
        }
      } else {
        console.log(`[process-plan] No Agent 0 page_annotations, sending all ${images.length} pages`);
      }

      // ==============================
      // PERSIST PAGE IMAGES TO STORAGE (for resume capability)
      // ==============================
      const pageIndexMap = Array.from({ length: images.length }, (_, i) => i);
      await persistPageImages(sessionId, images, pageIndexMap);

      const batches = batchImages(images, 5);
      let allItems: unknown[] = [];
      let detectedLevels: { depth: number; name: string }[] = [];
      let previousContext = "";

      // Compute batch page mapping for resume
      const batchPageMapping: number[][] = batches.map((batch, batchIdx) => {
        const startIdx = batchIdx * 5;
        return batch.map((_, i) => startIdx + i);
      });

      console.log(`[process-plan] Step 1 vision: ${images.length} images in ${batches.length} batches`);
      for (let bi = 0; bi < batches.length; bi++) {
        console.log(`[process-plan] Batch ${bi + 1}: ${batches[bi].length} pages`);
      }
      const totalBatchedPages = batches.reduce((sum, b) => sum + b.length, 0);
      if (totalBatchedPages !== images.length) {
        console.error(`[process-plan] BATCH VERIFICATION FAILED: ${totalBatchedPages} batched pages != ${images.length} filtered pages`);
      }

      for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
        // Time check: chain to new invocation if running low
        if (shouldChain(startTime)) {
          console.log(`[process-plan] Time limit approaching before vision batch ${batchIdx + 1}, chaining...`);
          await logApiCall({ session_id: sessionId, edge_function: "process-plan", step_label: `Time limit approaching, chaining (vision batch ${batchIdx} completed)`, status: "success" });
          await dispatchChain(sessionId);
          return;
        }
        // Ownership check before each extraction batch
        if (!(await checkOwnership(sessionId, pipelineRunId))) return;

        const batch = batches[batchIdx];

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
          batchLabel: `Step 1: Plan Extraction (Batch ${batchIdx + 1} of ${batches.length})`,
          extractionMode,
          tableStructure: extractionMode === "table" ? classification?.table_structure : undefined,
          hierarchyPattern: (extractionMode === "table" || extractionMode === "presentation") ? classification?.hierarchy_pattern : undefined,
          pageAnnotations: extractionMode === "presentation" ? classification?.page_annotations : undefined,
          nonPlanContent: extractionMode === "presentation" ? classification?.non_plan_content : undefined,
        });

        if (result.ok && (result.data as { success: boolean }).success) {
          const d = (result.data as { data: { items?: unknown[]; detectedLevels?: { depth: number; name: string }[]; documentTerminology?: { columnHierarchy?: string[] } }; contextSummary?: string }).data;

          if (d.items?.length) {
            allItems = mergeVisionBatchResults(allItems, d.items);
          }

          if (batchIdx === 0 && d.documentTerminology?.columnHierarchy?.length) {
            detectedLevels = d.documentTerminology.columnHierarchy.map(
              (name: string, idx: number) => ({ depth: idx + 1, name })
            );
          } else if (d.detectedLevels?.length && detectedLevels.length === 0) {
            detectedLevels = d.detectedLevels;
          }

          const ctx = (result.data as { contextSummary?: string }).contextSummary;
          if (ctx) previousContext = ctx;
        } else {
          console.warn(`[process-plan] Vision batch ${batchIdx + 1} failed:`, (result.data as { error?: string }).error);
        }

        // ==============================
        // PER-BATCH PERSISTENCE: save incremental state after each batch
        // ==============================
        const isLastBatch = batchIdx === batches.length - 1;
        await updateSessionProgress(sessionId, {
          current_step: isLastBatch ? "extracting" : "extracting",
          step_results: {
            extraction: {
              items: allItems,
              detectedLevels: detectedLevels.length > 0 ? detectedLevels : [
                { depth: 1, name: "Strategic Priority" },
                { depth: 2, name: "Objective" },
                { depth: 3, name: "Goal" },
                { depth: 4, name: "Strategy" },
                { depth: 5, name: "KPI" },
              ],
              batches_completed: batchIdx + 1,
              batches_total: batches.length,
              batch_pages: batchPageMapping,
              total_filtered_images: images.length,
              completed_at: isLastBatch ? new Date().toISOString() : null,
            },
            classification: classification || null,
            pipelineContext: {
              organizationName,
              industry,
              planLevels,
              documentText: (documentText as string) || "",
              extractionMethod,
              useVision,
              previousContext,
              extractionMode,
              tableStructure: extractionMode === "table" ? classification?.table_structure : undefined,
              hierarchyPattern: (extractionMode === "table" || extractionMode === "presentation") ? classification?.hierarchy_pattern : undefined,
              pageAnnotations: extractionMode === "presentation" ? classification?.page_annotations : undefined,
              nonPlanContent: extractionMode === "presentation" ? classification?.non_plan_content : undefined,
              documentHints,
              pageRange,
            },
          },
        });
        console.log(`[process-plan] Batch ${batchIdx + 1}/${batches.length} persisted (${allItems.length} cumulative items)`);
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
        // Vision produced 0 items — try text fallback if documentText available
        const fallbackText = (body.documentText as string) || "";
        if (fallbackText.trim().length > 50) {
          console.warn("[process-plan] Vision extraction produced 0 items, falling back to text extraction...");

          await logApiCall({
            session_id: sessionId,
            edge_function: "process-plan",
            step_label: "Step 1: Vision extraction failed — falling back to text extraction results",
            status: "success",
            error_message: "Vision produced 0 items across all batches",
          });

          const textResult = await callEdgeFunction("extract-plan-items", {
            documentText: fallbackText,
            organizationName,
            industry,
            documentHints,
            planLevels,
            pageRange,
            sessionId,
          });

          if (textResult.ok && (textResult.data as { success: boolean }).success) {
            const d = (textResult.data as { data: { items: unknown[]; detectedLevels: { depth: number; name: string }[] } }).data;
            if (d.items?.length > 0) {
              agent1Data = { items: d.items, detectedLevels: d.detectedLevels || [] };
              extractionMethod = "text_fallback";
              console.log(`[process-plan] Text fallback succeeded: ${d.items.length} items`);
            } else {
              agent1Error = "Both vision and text extraction produced no items";
            }
          } else {
            agent1Error = "Vision produced 0 items and text extraction also failed";
          }
        } else {
          agent1Error = "Vision extraction produced no items across all batches (no text available for fallback)";
        }
      }
    } else {
      // ==============================
      // BATCHED TEXT EXTRACTION (used for text_heavy override or no-vision documents)
      // ==============================
      const textToExtract = (documentText as string).trim();
      const textChunks = splitDocumentIntoChunks(textToExtract);
      const totalChunks = textChunks.length;
      console.log(`[process-plan] Step 1 text: ${textToExtract.length} chars in ${totalChunks} chunk(s)`);

      let allTextItems: unknown[] = [];
      let textDetectedLevels: { depth: number; name: string }[] = [];

      for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
        // Time check: chain to new invocation if running low
        if (shouldChain(startTime)) {
          console.log(`[process-plan] Time limit approaching before text chunk ${chunkIdx + 1}, chaining...`);
          await logApiCall({ session_id: sessionId, edge_function: "process-plan", step_label: `Time limit approaching, chaining (text chunk ${chunkIdx} completed)`, status: "success" });
          await dispatchChain(sessionId);
          return;
        }
        // Ownership check before each text extraction batch
        if (!(await checkOwnership(sessionId, pipelineRunId))) return;

        if (chunkIdx > 0) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        }

        const result = await callEdgeFunction("extract-plan-items", {
          documentText: textChunks[chunkIdx],
          organizationName,
          industry,
          documentHints,
          planLevels,
          pageRange,
          sessionId,
          batchLabel: `Step 1: Text Extraction (Chunk ${chunkIdx + 1} of ${totalChunks})`,
        });

        if (result.ok && (result.data as { success: boolean }).success) {
          const d = (result.data as { data: { items: unknown[]; detectedLevels: { depth: number; name: string }[] } }).data;
          if (d.items?.length) {
            allTextItems = [...allTextItems, ...d.items];
          }
          if (d.detectedLevels?.length && textDetectedLevels.length === 0) {
            textDetectedLevels = d.detectedLevels;
          }
        } else {
          console.warn(`[process-plan] Text chunk ${chunkIdx + 1} failed:`, (result.data as { error?: string }).error);
        }

        // Per-batch persistence for text extraction
        const isLastChunk = chunkIdx === totalChunks - 1;
        await updateSessionProgress(sessionId, {
          current_step: "extracting",
          step_results: {
            extraction: {
              items: allTextItems,
              detectedLevels: textDetectedLevels.length > 0 ? textDetectedLevels : [
                { depth: 1, name: "Strategic Priority" },
                { depth: 2, name: "Objective" },
                { depth: 3, name: "Goal" },
                { depth: 4, name: "Strategy" },
                { depth: 5, name: "KPI" },
              ],
              batches_completed: chunkIdx + 1,
              batches_total: totalChunks,
              completed_at: isLastChunk ? new Date().toISOString() : null,
            },
            classification: classification || null,
            pipelineContext: {
              organizationName,
              industry,
              planLevels,
              documentText: textToExtract,
              extractionMethod,
              useVision: false,
              extractionMode,
              documentHints,
              pageRange,
            },
          },
        });
        console.log(`[process-plan] Text chunk ${chunkIdx + 1}/${totalChunks} persisted (${allTextItems.length} cumulative items)`);
      }

      if (allTextItems.length > 0) {
        agent1Data = {
          items: allTextItems,
          detectedLevels: textDetectedLevels.length > 0 ? textDetectedLevels : [
            { depth: 1, name: "Strategic Priority" },
            { depth: 2, name: "Objective" },
            { depth: 3, name: "Goal" },
            { depth: 4, name: "Strategy" },
            { depth: 5, name: "KPI" },
          ],
        };
      } else {
        agent1Error = "Text extraction produced no items";
      }
    }

    if (!agent1Data || agent1Data.items.length === 0) {
      console.error("[process-plan] Agent 1 failed:", agent1Error);
      await updateSessionProgress(sessionId, {
        status: "error",
        current_step: "error",
        step_results: { error: agent1Error || "Extraction produced no items", pipelineStep: "agent1" },
      });
      return;
    }

    let agent1ItemCount = countAllItems(agent1Data.items);
    let agent1NameSet = collectItemNameSet(agent1Data.items);
    console.log(`[process-plan] Step 1 complete: ${agent1ItemCount} items, ${agent1Data.detectedLevels.length} levels, ${agent1NameSet.size} unique names`);

    // ==============================
    // SAFETY NET: Low-item fallback to standard mode
    // ==============================
    const totalPages = (pageImages as string[]).length;
    if (useVision && agent1ItemCount < 5 && totalPages > 10) {
      console.warn(`[process-plan] Safety net triggered: only ${agent1ItemCount} items from ${totalPages} pages. Re-running in standard mode...`);

      await logApiCall({
        session_id: sessionId,
        edge_function: "process-plan",
        step_label: "Safety net: re-extracting in standard mode",
        status: "success",
      });

      const fallbackBatches = batchImages(pageImages as string[], 5);
      let fallbackItems: unknown[] = [];
      let fallbackLevels: { depth: number; name: string }[] = [];
      let fallbackContext = "";

      for (let bi = 0; bi < fallbackBatches.length; bi++) {
        if (bi > 0) await new Promise(r => setTimeout(r, 3000));
        const result = await callEdgeFunction("extract-plan-vision", {
          pageImages: fallbackBatches[bi],
          previousContext: fallbackContext,
          organizationName,
          industry,
          documentHints,
          planLevels,
          pageRange,
          sessionId,
          batchLabel: `Safety net (Batch ${bi + 1}/${fallbackBatches.length})`,
          extractionMode: "standard",
        });
        if (result.ok && (result.data as { success: boolean }).success) {
          const d = (result.data as { data: { items?: unknown[]; detectedLevels?: { depth: number; name: string }[] }; contextSummary?: string });
          const innerData = d.data;
          if (innerData.items?.length) fallbackItems = mergeVisionBatchResults(fallbackItems, innerData.items);
          if (bi === 0 && innerData.detectedLevels?.length) fallbackLevels = innerData.detectedLevels;
          const ctx = (result.data as { contextSummary?: string }).contextSummary;
          if (ctx) fallbackContext = ctx;
        }
      }

      const fallbackCount = countAllItems(fallbackItems);
      console.log(`[process-plan] Safety net result: ${fallbackCount} items vs original ${agent1ItemCount}`);

      if (fallbackCount > agent1ItemCount) {
        console.log("[process-plan] Using safety net results (more items)");
        agent1Data = {
          items: fallbackItems,
          detectedLevels: fallbackLevels.length > 0 ? fallbackLevels : agent1Data.detectedLevels,
        };
        agent1ItemCount = fallbackCount;
        agent1NameSet = collectItemNameSet(agent1Data.items);
      }
    }

    // ==============================
    // DEDUPLICATION (after merge/safety-net, before checkpoint)
    // ==============================
    // Ownership check before dedup/checkpoint
    if (!(await checkOwnership(sessionId, pipelineRunId))) return;

    const dedupStart = Date.now();
    const beforeDedupCount = countAllItems(agent1Data.items);
    const dedupResult = deduplicateItems(agent1Data.items);
    agent1Data.items = dedupResult.items;
    agent1ItemCount = countAllItems(agent1Data.items);
    agent1NameSet = collectItemNameSet(agent1Data.items);
    const dedupDuration = Date.now() - dedupStart;

    // Log dedup results to admin timeline
    await logApiCall({
      session_id: sessionId,
      edge_function: "dedup-merge",
      step_label: "Step 1.5: Dedup & Merge",
      status: "success",
      input_tokens: 0,
      output_tokens: 0,
      duration_ms: dedupDuration,
      request_payload: {
        input_count: beforeDedupCount,
        output_count: agent1ItemCount,
        duplicates_removed: dedupResult.removedDetails.length,
        skipped_different_parents: dedupResult.skippedDetails.length,
      },
      response_payload: {
        removed_items: dedupResult.removedDetails.map(d => ({ removed_name: d.removed_name, removed_parent: d.removed_parent, kept_name: d.kept_name, kept_parent: d.kept_parent, match_reason: d.match_reason })),
        skipped_items: dedupResult.skippedDetails.map(s => `Skipped: '${s.name}' under '${s.parentA}' vs '${s.parentB}' — same name but different parents, kept both`),
        final_items: (agent1Data.items as { name?: string }[]).map(i => i.name || ""),
      },
    });

    // ==============================
    // PERSIST EXTRACTION before Agents 2+3 (resumability checkpoint)
    // ==============================
    const extractionSnapshot = {
      extraction: {
        items: agent1Data.items,
        detectedLevels: agent1Data.detectedLevels,
        completed_at: new Date().toISOString(),
      },
      classification: classification || null,
      pipelineContext: {
        organizationName,
        industry,
        planLevels,
        documentText: (documentText as string) || "",
        extractionMethod,
        useVision,
      },
      audit: null,
      validation: null,
    };
    await updateSessionProgress(sessionId, {
      current_step: "extraction_complete",
      step_results: extractionSnapshot,
    });
    console.log(`[process-plan] Extraction checkpoint persisted (${agent1ItemCount} items), proceeding to Agents 2+3`);

    // ==============================
    // STEP 2: Audit Completeness ONLY — Agent 3 runs in next resume cycle
    // ==============================
    // Time check before Agent 2
    if (shouldChain(startTime)) {
      console.log("[process-plan] Time limit approaching before Agent 2, chaining...");
      await logApiCall({ session_id: sessionId, edge_function: "process-plan", step_label: "Time limit approaching, chaining before Agent 2", status: "success" });
      await dispatchChain(sessionId);
      return;
    }

    if (!(await checkOwnership(sessionId, pipelineRunId))) return;

    await updateSessionProgress(sessionId, { current_step: "auditing" });
    console.log("[process-plan] Starting Step 2 (audit-completeness) — Agent 3 will run in next resume cycle");

    const sourceForAudit = (documentText as string) || "";
    const hasSourceText = sourceForAudit.length > 100;

    let auditFindings: AuditFindings | null = null;

    if (hasSourceText || (useVision && pageImages)) {
      const auditPayload: Record<string, unknown> = {
        extractedItems: agent1Data.items,
        sessionId,
        organizationName,
        industry,
        planLevels,
        classification: classification || null,
      };

      if (hasSourceText) {
        auditPayload.sourceText = sourceForAudit;
        console.log("[process-plan] Step 2: text-based audit");
      } else if (useVision && pageImages) {
        const images = pageImages as string[];
        const auditImages = images.length <= 10 ? images : selectAuditImages(images);
        auditPayload.pageImages = auditImages;
        console.log(`[process-plan] Step 2: vision-based audit with ${auditImages.length} of ${images.length} images`);
      }

      try {
        const auditResult = await callEdgeFunction("audit-completeness", auditPayload);
        if (auditResult.ok && (auditResult.data as { success: boolean }).success) {
          auditFindings = (auditResult.data as { data: AuditFindings }).data;
          console.log("[process-plan] Step 2 complete:", JSON.stringify(auditFindings?.auditSummary || {}));
        } else {
          console.error("[process-plan] Step 2 failed (non-fatal):", JSON.stringify(auditResult.data));
        }
      } catch (err) {
        console.error("[process-plan] Step 2 exception:", err);
      }
    } else {
      console.log("[process-plan] Step 2 skipped — no source text or images available");
    }

    // Persist audit results as "audited" — Agent 3 will be triggered by next resume
    if (!(await checkOwnership(sessionId, pipelineRunId))) return;

    await updateSessionProgress(sessionId, {
      current_step: "audited",
      step_results: {
        ...extractionSnapshot,
        audit: auditFindings,
        pipelineContext: {
          ...extractionSnapshot.pipelineContext,
          documentText: sourceForAudit,
        },
      },
    });
    console.log("[process-plan] Agent 2 complete, persisted as 'audited'. Chaining to Agent 3.");

    // Fire-and-forget cleanup of stored page images (no longer needed after audit)
    cleanupPageImages(sessionId).catch(e => console.error("[process-plan] Cleanup error:", e));

    // Self-chain to run Agent 3 instead of waiting for browser stall detector
    await dispatchChain(sessionId);

  } catch (error) {
    console.error("[process-plan] Pipeline error:", error);
    if (await checkOwnership(sessionId, pipelineRunId)) {
      await updateSessionProgress(sessionId, {
        status: "error",
        current_step: "error",
        step_results: { error: "Pipeline processing failed. Please try again." },
      });
    } else {
      console.warn(`[process-plan] Suppressing error write — run ${pipelineRunId} was superseded`);
    }
  }
}

// ==============================
// Resume function: handles mid-extraction AND post-extraction resume
// ==============================
async function runResume(sessionId: string): Promise<void> {
  const startTime = Date.now();
  const pipelineRunId = crypto.randomUUID();
  console.log(`[process-plan] Starting resume pipeline run ${pipelineRunId} for session ${sessionId}`);
  await updateSessionProgress(sessionId, { pipeline_run_id: pipelineRunId });

  try {
    const client = getServiceClient();
    const { data: session, error: fetchError } = await client
      .from("processing_sessions")
      .select("step_results, current_step, org_name, org_industry")
      .eq("id", sessionId)
      .single();

    if (fetchError || !session) {
      console.error("[process-plan] Resume: session not found", fetchError);
      return;
    }

    const currentStep = (session as Record<string, unknown>).current_step as string;
    if (currentStep === "completed" || currentStep === "complete") {
      console.log("[process-plan] Resume: already completed, nothing to do");
      return;
    }

    const stepResults = (session as Record<string, unknown>).step_results as Record<string, unknown>;

    // ==============================
    // PATH A: Resume mid-extraction (current_step === "extracting")
    // ==============================
    if (currentStep === "extracting") {
      const extraction = stepResults?.extraction as Record<string, unknown> | undefined;
      if (!extraction) {
        console.error("[process-plan] Resume: no extraction data in step_results for extracting state");
        return;
      }

      const batchesCompleted = (extraction.batches_completed || 0) as number;
      const batchesTotal = (extraction.batches_total || 0) as number;
      const batchPages = (extraction.batch_pages || []) as number[][];
      const totalFilteredImages = (extraction.total_filtered_images || 0) as number;
      const existingItems = (extraction.items || []) as unknown[];
      let detectedLevels = (extraction.detectedLevels || []) as { depth: number; name: string }[];

      const pipeCtx = (stepResults.pipelineContext || {}) as Record<string, unknown>;
      const organizationName = pipeCtx.organizationName as string | undefined;
      const industry = pipeCtx.industry as string | undefined;
      const planLevels = pipeCtx.planLevels as unknown[] | undefined;
      const extractionMethod = (pipeCtx.extractionMethod || "vision") as string;
      const documentText = (pipeCtx.documentText || "") as string;
      const useVision = pipeCtx.useVision as boolean;
      const previousContextFromState = (pipeCtx.previousContext || "") as string;
      const extractionMode = (pipeCtx.extractionMode || "standard") as string;
      const documentHints = pipeCtx.documentHints as string | undefined;
      const pageRange = pipeCtx.pageRange as unknown;
      const classification = (stepResults.classification || null) as Record<string, unknown> | null;

      if (batchesCompleted >= batchesTotal) {
        // All batches done but dedup/agents never ran
        console.log(`[process-plan] Resume: all ${batchesTotal} batches completed, running dedup + Agents 2+3`);

        await logApiCall({
          session_id: sessionId,
          edge_function: "process-plan",
          step_label: "Resume: all batches done, running dedup + Agents 2+3",
          status: "success",
        });

        // Run dedup
        const dedupStart = Date.now();
        const beforeDedupCount = countAllItems(existingItems);
        const dedupResult = deduplicateItems(existingItems);
        const dedupDuration = Date.now() - dedupStart;
        const dedupedItems = dedupResult.items;
        const dedupedItemCount = countAllItems(dedupedItems);

        await logApiCall({
          session_id: sessionId,
          edge_function: "dedup-merge",
          step_label: "Step 1.5: Dedup & Merge (Resume)",
          status: "success",
          input_tokens: 0,
          output_tokens: 0,
          duration_ms: dedupDuration,
          request_payload: { input_count: beforeDedupCount, output_count: dedupedItemCount, duplicates_removed: dedupResult.removedDetails.length },
          response_payload: { removed_items: dedupResult.removedDetails },
        });

        // Persist extraction_complete checkpoint
        await updateSessionProgress(sessionId, {
          current_step: "extraction_complete",
          step_results: {
            extraction: { items: dedupedItems, detectedLevels, completed_at: new Date().toISOString() },
            classification,
            pipelineContext: { organizationName, industry, planLevels, documentText, extractionMethod, useVision },
          },
        });

        // Self-chain to run Agent 2 instead of waiting for browser stall detector
        console.log("[process-plan] Resume: extraction complete, chaining to Agent 2");
        await dispatchChain(sessionId);
        return;
      }

      // Some batches remain — resume extraction
      console.log(`[process-plan] Resume: ${batchesCompleted} of ${batchesTotal} batches done, resuming extraction`);

      await logApiCall({
        session_id: sessionId,
        edge_function: "process-plan",
        step_label: `Resume: continuing extraction from batch ${batchesCompleted + 1}`,
        status: "success",
      });

      // ==============================
      // TEXT EXTRACTION RESUME PATH
      // ==============================
      if (extractionMethod === "text" && documentText.length > 50) {
        console.log(`[process-plan] Resume: using text extraction path`);
        const textChunks = splitDocumentIntoChunks(documentText.trim());
        let allItems = [...existingItems];

        for (let chunkIdx = batchesCompleted; chunkIdx < textChunks.length; chunkIdx++) {
          // Time check
          if (shouldChain(startTime)) {
            console.log(`[process-plan] Resume: time limit before text chunk ${chunkIdx + 1}, chaining...`);
            await logApiCall({ session_id: sessionId, edge_function: "process-plan", step_label: `Time limit, chaining (resume text chunk ${chunkIdx} completed)`, status: "success" });
            await dispatchChain(sessionId);
            return;
          }
          if (!(await checkOwnership(sessionId, pipelineRunId))) return;

          if (chunkIdx > batchesCompleted) {
            await new Promise(resolve => setTimeout(resolve, 3000));
          }

          const result = await callEdgeFunction("extract-plan-items", {
            documentText: textChunks[chunkIdx],
            organizationName,
            industry,
            documentHints,
            planLevels,
            pageRange,
            sessionId,
            batchLabel: `Step 1: Text Extraction (Chunk ${chunkIdx + 1} of ${textChunks.length}) [Resume]`,
          });

          if (result.ok && (result.data as { success: boolean }).success) {
            const d = (result.data as { data: { items?: unknown[]; detectedLevels?: { depth: number; name: string }[] } }).data;
            if (d.items?.length) {
              allItems = [...allItems, ...d.items];
            }
            if (d.detectedLevels?.length && detectedLevels.length === 0) {
              detectedLevels = d.detectedLevels;
            }
          } else {
            console.warn(`[process-plan] Resume: Text chunk ${chunkIdx + 1} failed:`, (result.data as { error?: string }).error);
          }

          const isLastChunk = chunkIdx === textChunks.length - 1;
          await updateSessionProgress(sessionId, {
            current_step: "extracting",
            step_results: {
              extraction: {
                items: allItems,
                detectedLevels,
                batches_completed: chunkIdx + 1,
                batches_total: textChunks.length,
                completed_at: isLastChunk ? new Date().toISOString() : null,
              },
              classification,
              pipelineContext: { ...pipeCtx },
            },
          });
          console.log(`[process-plan] Resume: Text chunk ${chunkIdx + 1}/${textChunks.length} persisted (${allItems.length} cumulative items)`);
        }

        // Run dedup
        const dedupStart = Date.now();
        const beforeDedupCount = countAllItems(allItems);
        const dedupResult = deduplicateItems(allItems);
        const dedupDuration = Date.now() - dedupStart;
        const dedupedItems = dedupResult.items;
        const dedupedItemCount = countAllItems(dedupedItems);

        await logApiCall({
          session_id: sessionId,
          edge_function: "dedup-merge",
          step_label: "Step 1.5: Dedup & Merge (Resume)",
          status: "success",
          input_tokens: 0,
          output_tokens: 0,
          duration_ms: dedupDuration,
          request_payload: { input_count: beforeDedupCount, output_count: dedupedItemCount, duplicates_removed: dedupResult.removedDetails.length },
          response_payload: { removed_items: dedupResult.removedDetails },
        });

        await updateSessionProgress(sessionId, {
          current_step: "extraction_complete",
          step_results: {
            extraction: { items: dedupedItems, detectedLevels, completed_at: new Date().toISOString() },
            classification,
            pipelineContext: { organizationName, industry, planLevels, documentText, extractionMethod, useVision },
          },
        });

        // Agent 2 will be picked up by next resume cycle (stall detector fires in ~20s)
        console.log("[process-plan] Resume: text extraction complete, returning for Agent 2 in next cycle");
        return;
      }

      // ==============================
      // VISION EXTRACTION RESUME PATH (original)
      // ==============================
      // Download images from storage
      const allImages = await loadPageImages(sessionId, totalFilteredImages);
      if (allImages.length === 0) {
        console.error("[process-plan] Resume: failed to load page images from storage");
        await updateSessionProgress(sessionId, {
          status: "error",
          current_step: "error",
          step_results: { error: "Resume failed: could not load stored page images" },
        });
        return;
      }

      // Re-batch images and continue from where we left off
      const batches = batchImages(allImages, 5);
      let allItems = [...existingItems];
      let previousContext = previousContextFromState;

      for (let batchIdx = batchesCompleted; batchIdx < batches.length; batchIdx++) {
        // Ownership check before each resumed extraction batch
        if (!(await checkOwnership(sessionId, pipelineRunId))) return;

        const batch = batches[batchIdx];

        if (batchIdx > batchesCompleted) {
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
          batchLabel: `Step 1: Plan Extraction (Batch ${batchIdx + 1} of ${batches.length}) [Resume]`,
          extractionMode,
          tableStructure: pipeCtx.tableStructure,
          hierarchyPattern: pipeCtx.hierarchyPattern,
          pageAnnotations: pipeCtx.pageAnnotations,
          nonPlanContent: pipeCtx.nonPlanContent,
        });

        if (result.ok && (result.data as { success: boolean }).success) {
          const d = (result.data as { data: { items?: unknown[]; detectedLevels?: { depth: number; name: string }[]; documentTerminology?: { columnHierarchy?: string[] } }; contextSummary?: string }).data;

          if (d.items?.length) {
            allItems = mergeVisionBatchResults(allItems, d.items);
          }

          if (d.detectedLevels?.length && detectedLevels.length === 0) {
            detectedLevels = d.detectedLevels;
          }

          const ctx = (result.data as { contextSummary?: string }).contextSummary;
          if (ctx) previousContext = ctx;
        } else {
          console.warn(`[process-plan] Resume: Vision batch ${batchIdx + 1} failed:`, (result.data as { error?: string }).error);
        }

        // Per-batch persistence during resume too
        const isLastBatch = batchIdx === batches.length - 1;
        await updateSessionProgress(sessionId, {
          current_step: "extracting",
          step_results: {
            extraction: {
              items: allItems,
              detectedLevels,
              batches_completed: batchIdx + 1,
              batches_total: batches.length,
              batch_pages: batchPages,
              total_filtered_images: totalFilteredImages,
              completed_at: isLastBatch ? new Date().toISOString() : null,
            },
            classification,
            pipelineContext: { ...pipeCtx, previousContext },
          },
        });
        console.log(`[process-plan] Resume: Batch ${batchIdx + 1}/${batches.length} persisted (${allItems.length} cumulative items)`);
      }

      // Run dedup
      const dedupStart = Date.now();
      const beforeDedupCount = countAllItems(allItems);
      const dedupResult = deduplicateItems(allItems);
      const dedupDuration = Date.now() - dedupStart;
      const dedupedItems = dedupResult.items;
      const dedupedItemCount = countAllItems(dedupedItems);

      await logApiCall({
        session_id: sessionId,
        edge_function: "dedup-merge",
        step_label: "Step 1.5: Dedup & Merge (Resume)",
        status: "success",
        input_tokens: 0,
        output_tokens: 0,
        duration_ms: dedupDuration,
        request_payload: { input_count: beforeDedupCount, output_count: dedupedItemCount, duplicates_removed: dedupResult.removedDetails.length },
        response_payload: { removed_items: dedupResult.removedDetails },
      });

      // Persist extraction_complete checkpoint
      await updateSessionProgress(sessionId, {
        current_step: "extraction_complete",
        step_results: {
          extraction: { items: dedupedItems, detectedLevels, completed_at: new Date().toISOString() },
          classification,
          pipelineContext: { organizationName, industry, planLevels, documentText, extractionMethod, useVision },
        },
      });

      // Agent 2 will be picked up by next resume cycle (stall detector fires in ~20s)
      console.log("[process-plan] Resume: vision extraction complete, returning for Agent 2 in next cycle");
      cleanupPageImages(sessionId).catch(e => console.error("[process-plan] Resume cleanup error:", e));
      return;
    }

    // ==============================
    // PATH B: Resume post-extraction states
    // ==============================
    const postExtractionStates = ["extraction_complete", "auditing", "audited", "validating"];
    if (!postExtractionStates.includes(currentStep)) {
      console.error("[process-plan] Resume: unexpected current_step:", currentStep);
      return;
    }

    const extraction = stepResults?.extraction as Record<string, unknown> | undefined;
    if (!extraction || !Array.isArray(extraction.items) || extraction.items.length === 0) {
      console.error("[process-plan] Resume: no extraction items in step_results for state:", currentStep);
      return;
    }

    const agent1Items = extraction.items as unknown[];
    const agent1DetectedLevels = (extraction.detectedLevels || []) as { depth: number; name: string }[];
    const classification = (stepResults.classification || null) as Record<string, unknown> | null;
    const pipeCtx = (stepResults.pipelineContext || {}) as Record<string, unknown>;
    const organizationName = (pipeCtx.organizationName || (session as Record<string, unknown>).org_name) as string | undefined;
    const industry = (pipeCtx.industry || (session as Record<string, unknown>).org_industry) as string | undefined;
    const planLevels = pipeCtx.planLevels as unknown[] | undefined;
    const extractionMethod = (pipeCtx.extractionMethod || "vision") as string;
    const sourceText = (pipeCtx.documentText || "") as string;

    if (currentStep === "extraction_complete" || currentStep === "auditing") {
      // Agent 2 hasn't finished — run (or re-run) Agent 2
      console.log(`[process-plan] Resume: state '${currentStep}' → running Agent 2`);
      await runAgent2Only(sessionId, agent1Items, agent1DetectedLevels, classification, organizationName, industry, planLevels, extractionMethod, sourceText, pipelineRunId, stepResults);
      cleanupPageImages(sessionId).catch(e => console.error("[process-plan] Resume cleanup error:", e));
    } else if (currentStep === "audited" || currentStep === "validating") {
      // Agent 2 done, Agent 3 hasn't finished — run (or re-run) Agent 3
      console.log(`[process-plan] Resume: state '${currentStep}' → running Agent 3`);
      const auditFindings = (stepResults.audit || null) as AuditFindings | null;
      await runAgent3Only(sessionId, agent1Items, agent1DetectedLevels, classification, organizationName, industry, planLevels, extractionMethod, auditFindings, pipelineRunId, stepResults);
    }

  } catch (error) {
    console.error("[process-plan] Resume error:", error);
    // Guard: only write error status if this run still owns the session
    if (await checkOwnership(sessionId, pipelineRunId)) {
      await updateSessionProgress(sessionId, {
        status: "error",
        current_step: "error",
        step_results: { error: "Resume pipeline failed. Please try again." },
      });
    } else {
      console.warn(`[process-plan] Suppressing resume error write — run ${pipelineRunId} was superseded`);
    }
  }
}

/** Run Agent 2 (audit-completeness) only, persist as "audited" */
async function runAgent2Only(
  sessionId: string,
  agent1Items: unknown[],
  agent1DetectedLevels: { depth: number; name: string }[],
  classification: Record<string, unknown> | null,
  organizationName: string | undefined,
  industry: string | undefined,
  planLevels: unknown[] | undefined,
  extractionMethod: string,
  sourceText: string,
  pipelineRunId: string,
  existingStepResults: Record<string, unknown>
): Promise<void> {
  console.log(`[process-plan] Running Agent 2 only (${countAllItems(agent1Items)} items)`);

  await logApiCall({
    session_id: sessionId,
    edge_function: "process-plan",
    step_label: "Starting Agent 2 (audit-completeness)",
    status: "success",
  });

  if (!(await checkOwnership(sessionId, pipelineRunId))) return;

  await updateSessionProgress(sessionId, { current_step: "auditing" });

  const hasSourceText = sourceText.length > 100;
  let auditFindings: AuditFindings | null = null;

  if (hasSourceText) {
    const auditPayload: Record<string, unknown> = {
      extractedItems: agent1Items,
      sessionId,
      organizationName,
      industry,
      planLevels,
      classification,
      sourceText,
    };

    try {
      const result = await callEdgeFunction("audit-completeness", auditPayload);
      if (result.ok && (result.data as { success: boolean }).success) {
        auditFindings = (result.data as { data: AuditFindings }).data;
        console.log("[process-plan] Agent 2 complete:", JSON.stringify(auditFindings?.auditSummary || {}));
      } else {
        console.warn("[process-plan] Agent 2 failed (non-fatal):", JSON.stringify(result.data));
      }
    } catch (err) {
      console.error("[process-plan] Agent 2 exception:", err);
    }
  } else {
    console.log("[process-plan] Agent 2 skipped — no source text available");
  }

  if (!(await checkOwnership(sessionId, pipelineRunId))) return;

  await updateSessionProgress(sessionId, {
    current_step: "audited",
    step_results: {
      ...existingStepResults,
      audit: auditFindings,
    },
  });
  console.log("[process-plan] Agent 2 persisted as 'audited'. Agent 3 will run in next resume cycle.");

  await logApiCall({
    session_id: sessionId,
    edge_function: "process-plan",
    step_label: "Agent 2 complete — awaiting Agent 3 resume",
    status: "success",
  });
}

/** Group top-level items into batches of ~BATCH_THRESHOLD total items */
function groupIntoBatches(topLevelItems: unknown[], threshold: number): unknown[][] {
  const batches: unknown[][] = [];
  let currentBatch: unknown[] = [];
  let currentCount = 0;

  for (const item of topLevelItems) {
    const subtreeSize = countAllItems([item]);
    if (currentBatch.length > 0 && currentCount + subtreeSize > threshold) {
      batches.push(currentBatch);
      currentBatch = [];
      currentCount = 0;
    }
    currentBatch.push(item);
    currentCount += subtreeSize;
  }
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }
  return batches;
}

/** Run Agent 3 (validate-hierarchy) only, then merge/confidence/complete */
async function runAgent3Only(
  sessionId: string,
  agent1Items: unknown[],
  agent1DetectedLevels: { depth: number; name: string }[],
  classification: Record<string, unknown> | null,
  organizationName: string | undefined,
  industry: string | undefined,
  planLevels: unknown[] | undefined,
  extractionMethod: string,
  auditFindings: AuditFindings | null,
  pipelineRunId: string,
  existingStepResults?: Record<string, unknown>
): Promise<void> {
  const agent1NameSet = collectItemNameSet(agent1Items);
  const totalItems = countAllItems(agent1Items);
  const BATCH_THRESHOLD = 75;
  const shouldBatch = totalItems > BATCH_THRESHOLD;

  console.log(`[process-plan] Running Agent 3 only (${totalItems} items, batch=${shouldBatch})`);

  await logApiCall({
    session_id: sessionId,
    edge_function: "process-plan",
    step_label: `Starting Agent 3 (validate-hierarchy)${shouldBatch ? ` — batched, ${totalItems} items` : ''}`,
    status: "success",
  });

  if (!(await checkOwnership(sessionId, pipelineRunId))) return;

  await updateSessionProgress(sessionId, { current_step: "validating" });

  let validationResult: ValidationResult | null = null;

  if (!shouldBatch) {
    // === Single-call path (≤75 items) — unchanged ===
    try {
      const result = await callEdgeFunction("validate-hierarchy", {
        extractedItems: agent1Items,
        auditFindings: auditFindings || null,
        detectedLevels: agent1DetectedLevels,
        sessionId,
        organizationName,
        industry,
        planLevels,
      });
      if (result.ok && (result.data as { success: boolean }).success) {
        validationResult = (result.data as { data: ValidationResult }).data;
        console.log("[process-plan] Agent 3 complete:", validationResult?.corrections?.length || 0, "corrections");
      } else {
        console.warn("[process-plan] Agent 3 failed (non-fatal):", JSON.stringify(result.data));
      }
    } catch (err) {
      console.error("[process-plan] Agent 3 exception:", err);
    }
  } else {
    // === Batched path (>75 items) ===
    const batches = groupIntoBatches(agent1Items, BATCH_THRESHOLD);
    console.log(`[process-plan] Agent 3 batching: ${batches.length} batches from ${totalItems} items`);

    // Build global context for cross-batch consistency
    const globalContext = `This document contains ${agent1Items.length} top-level items (${totalItems} total including children). Full list of top-level items and their types:\n${(agent1Items as { levelType?: string; name?: string }[]).map(item => `- (${item.levelType || '?'}) ${item.name || '(unnamed)'}`).join('\n')}\n\nYou are validating a subset of these. Use consistent level type assignments across all items.`;

    // Read already-completed batches from step_results for resume support
    const stepResults = existingStepResults || {};
    const completedBatches: Record<string, { correctedItems: unknown[]; corrections: unknown[] }> = 
      (stepResults.validationBatches || {}) as Record<string, { correctedItems: unknown[]; corrections: unknown[] }>;

    for (let i = 0; i < batches.length; i++) {
      // Skip already-completed batches (resume support)
      if (completedBatches[String(i)]) {
        console.log(`[process-plan] Agent 3 batch ${i + 1}/${batches.length} already complete, skipping`);
        continue;
      }

      if (!(await checkOwnership(sessionId, pipelineRunId))) return;

      const batchItems = batches[i];
      const batchItemCount = countAllItems(batchItems);
      console.log(`[process-plan] Agent 3 batch ${i + 1}/${batches.length}: ${batchItemCount} items`);

      await logApiCall({
        session_id: sessionId,
        edge_function: "process-plan",
        step_label: `Starting Agent 3 batch ${i + 1} of ${batches.length} (${batchItemCount} items)`,
        status: "success",
      });

      try {
        const result = await callEdgeFunction("validate-hierarchy", {
          extractedItems: batchItems,
          auditFindings: auditFindings || null,
          detectedLevels: agent1DetectedLevels,
          sessionId,
          organizationName,
          industry,
          planLevels,
          globalContext,
        });

        if (result.ok && (result.data as { success: boolean }).success) {
          const batchResult = (result.data as { data: { correctedItems: unknown[]; corrections: unknown[] } }).data;
          completedBatches[String(i)] = batchResult;
          console.log(`[process-plan] Agent 3 batch ${i + 1} complete: ${batchResult.correctedItems?.length || 0} items, ${batchResult.corrections?.length || 0} corrections`);

          // Persist batch result immediately for resume support
          // Re-read current step_results to avoid overwriting other fields
          const client = getServiceClient();
          const { data: currentSession } = await client.from("processing_sessions")
            .select("step_results").eq("id", sessionId).single();
          const currentStepResults = ((currentSession as Record<string, unknown>)?.step_results || {}) as Record<string, unknown>;
          
          await updateSessionProgress(sessionId, {
            step_results: {
              ...currentStepResults,
              validationBatches: completedBatches,
            },
          });

          await logApiCall({
            session_id: sessionId,
            edge_function: "process-plan",
            step_label: `Agent 3 batch ${i + 1} of ${batches.length} complete, persisted`,
            status: "success",
          });
        } else {
          console.warn(`[process-plan] Agent 3 batch ${i + 1} failed (non-fatal):`, JSON.stringify(result.data));
        }
      } catch (err) {
        console.error(`[process-plan] Agent 3 batch ${i + 1} exception:`, err);
      }
    }

    // Merge all batch results
    const allCorrectedItems: unknown[] = [];
    const allCorrections: unknown[] = [];
    let allDetectedLevels: { depth: number; name: string }[] = agent1DetectedLevels;

    for (let i = 0; i < batches.length; i++) {
      const batchResult = completedBatches[String(i)];
      if (batchResult) {
        allCorrectedItems.push(...(batchResult.correctedItems || []));
        allCorrections.push(...(batchResult.corrections || []));
        // Use detectedLevels from first batch that has them
        if (!allDetectedLevels.length && (batchResult as unknown as ValidationResult).detectedLevels?.length) {
          allDetectedLevels = (batchResult as unknown as ValidationResult).detectedLevels;
        }
      }
    }

    if (allCorrectedItems.length > 0) {
      validationResult = {
        correctedItems: allCorrectedItems,
        corrections: allCorrections as ValidationResult["corrections"],
        detectedLevels: allDetectedLevels,
      };
      console.log(`[process-plan] Agent 3 all ${batches.length} batches complete, merged: ${allCorrectedItems.length} items, ${allCorrections.length} corrections`);
    } else {
      console.warn("[process-plan] Agent 3 batched: no corrected items from any batch");
    }

    await logApiCall({
      session_id: sessionId,
      edge_function: "process-plan",
      step_label: `Agent 3 all batches complete, merging results (${allCorrectedItems.length} items)`,
      status: "success",
    });
  }

  // Merge & confidence scoring (unchanged)
  let finalItems: unknown[];
  let finalLevels: { depth: number; name: string }[];
  let corrections: { itemId: string; type: string; description: string }[] = [];

  if (validationResult?.correctedItems?.length && validationResult.correctedItems.length > 0) {
    finalItems = validationResult.correctedItems;
    finalLevels = validationResult.detectedLevels?.length ? validationResult.detectedLevels : agent1DetectedLevels;
    corrections = validationResult.corrections || [];
  } else {
    finalItems = agent1Items;
    finalLevels = agent1DetectedLevels;
  }

  if (planLevels && Array.isArray(planLevels) && planLevels.length > 0) {
    enforceMaxDepth(finalItems, planLevels.length, planLevels as { depth: number; name: string }[]);
  }

  if (auditFindings?.rephrasedItems?.length) {
    applyRephrasedCorrections(finalItems, auditFindings.rephrasedItems, corrections);
  }

  calculateConfidence(finalItems, agent1NameSet, auditFindings, corrections);

  const allConfidences: number[] = [];
  function gatherConf(items: unknown[]) {
    for (const item of items) {
      const i = item as { confidence?: number; children?: unknown[] };
      if (typeof i.confidence === "number") allConfidences.push(i.confidence);
      if (i.children?.length) gatherConf(i.children);
    }
  }
  gatherConf(finalItems);
  const sessionConfidence = allConfidences.length > 0
    ? Math.round(allConfidences.reduce((a, b) => a + b, 0) / allConfidences.length)
    : 0;

  const finalItemCount = countAllItems(finalItems);
  console.log(`[process-plan] Pipeline complete: ${finalItemCount} items, confidence=${sessionConfidence}%`);

  if (!(await checkOwnership(sessionId, pipelineRunId))) return;

  await updateSessionProgress(sessionId, {
    status: "completed",
    current_step: "complete",
    step_results: {
      success: true,
      data: { items: finalItems, detectedLevels: finalLevels },
      totalItems: finalItemCount,
      corrections,
      sessionConfidence,
      auditSummary: auditFindings?.auditSummary || null,
      extractionMethod,
      pipelineComplete: true,
      sessionId,
    },
    total_items_extracted: finalItemCount,
  });

  await logApiCall({
    session_id: sessionId,
    edge_function: "process-plan",
    step_label: "Pipeline completed successfully",
    status: "success",
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    // Resume mode: pick up from extracting or extraction_complete
    if (body.resume_session_id) {
      const resumeSessionId = body.resume_session_id as string;
      console.log("[process-plan] Resume requested for session:", resumeSessionId);

      runResume(resumeSessionId).catch((err) => {
        console.error("[process-plan] Resume fatal error:", err);
      });

      return new Response(JSON.stringify({
        success: true,
        sessionId: resumeSessionId,
        async: true,
        resumed: true,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Normal mode
    const { sessionId: incomingSessionId, documentText, pageImages } = body;

    if (!documentText && !pageImages) {
      return new Response(JSON.stringify({ success: false, error: "documentText or pageImages required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sessionId = await ensureSession(incomingSessionId);
    console.log("[process-plan] Pipeline starting, sessionId:", sessionId);

    // Update session to in_progress
    await updateSessionProgress(sessionId, { status: "in_progress", current_step: "queued" });

    // Fire off the pipeline in the background (non-awaited)
    runPipeline(sessionId, body).catch((err) => {
      console.error("[process-plan] Background pipeline fatal error:", err);
    });

    // Return immediately with sessionId
    return new Response(JSON.stringify({
      success: true,
      sessionId,
      async: true,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("[process-plan] Request error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: "Failed to start pipeline. Please try again.",
    }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
