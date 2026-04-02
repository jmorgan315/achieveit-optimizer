import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { logApiCall, ensureSession, extractTokenUsage, callAnthropicWithRetry } from "../_shared/logging.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};



const VALIDATION_SYSTEM_PROMPT = `You are a hierarchy and structure validator for strategic plan extractions. Your job is to produce a CORRECTED version of the extracted plan items by:

1. Verifying parent-child relationships match the document's structure (indentation, numbering, section nesting)
2. Verifying level assignments make sense (e.g., a KPI should not be parent of a Strategic Priority)
3. Checking that ordering within each parent matches the document order
4. Incorporating missing items (from the audit) into the correct positions in the hierarchy
5. Splitting merged items back into their original distinct items
6. Replacing rephrased item names with the EXACT original text from the document
7. MERGING DUPLICATE ITEMS — items that appear twice at adjacent levels with the same or very similar names

=== CRITICAL RULES ===

- You MUST output the COMPLETE corrected plan tree — every item, not just the changed ones
- For items that don't need changes, output them exactly as-is
- For each correction you make, add an entry to the corrections array explaining what changed and why
- Maintain the same item IDs for items that already have them
- For newly inserted items (from audit missing list), generate new IDs in format "new-1", "new-2", etc.
- The hierarchy must be properly nested with children arrays
- Level assignments should use the detected level names consistently

=== DUPLICATE MERGING ===

If a parent and its child have the same or very similar names (differing only in capitalization, abbreviation, or minor wording), they are DUPLICATES from the same item being extracted twice. MERGE them:
- Keep the parent item (with its level assignment)
- Move the duplicate child's children up to become direct children of the kept parent
- Remove the duplicate child
- Log this as a correction with type "merged_duplicate"

=== CAPITALIZATION ===

When you encounter the same item name in different capitalizations (e.g., 'BUILD A UNIVERSAL PATH TO EARLY LEARNING' vs 'Build a Universal Path to Early Learning'), always prefer the Title Case or sentence case version. ALL CAPS text in documents is typically a design/formatting choice, not the canonical name. Never output item names in ALL CAPS unless every version in the source document is ALL CAPS.

=== HANDLING AUDIT FINDINGS ===

Missing items: Insert them at the correct position in the hierarchy. Use the suggestedLevel and approximateLocation from the audit to determine placement.

Merged items: Split them back into the original distinct items. The merged item's children should be distributed appropriately among the split items.

Rephrased items: Replace the name with the originalText from the audit. Keep everything else about the item the same.

Duplicate items (from audit): Merge them as described in DUPLICATE MERGING above.

=== OUTPUT FORMAT ===

Return the FULL corrected items tree plus a corrections log. Every item should have: name, levelType, children (array), and retain any other fields from the original (description, owner, metricTarget, etc.).`;

function buildItemSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      id: { type: "string", description: "Item ID (keep original or 'new-N' for inserted items)" },
      name: { type: "string", description: "Item name (use EXACT source text)" },
      levelType: { type: "string", description: "Hierarchy level label" },
      description: { type: "string", description: "Item description" },
      owner: { type: "string", description: "Owner if known" },
      metricTarget: { type: "string", description: "Metric target value" },
      metricUnit: { type: "string", enum: ["Number", "Dollar", "Percentage", "None"], description: "Metric unit" },
      startDate: { type: "string", description: "Start date YYYY-MM-DD" },
      dueDate: { type: "string", description: "Due date YYYY-MM-DD" },
      children: {
        type: "array",
        description: "Child items",
        items: { $ref: "#" },
      },
    },
    required: ["id", "name", "levelType"],
  };
}

const validateToolSchema = {
  type: "object",
  properties: {
    correctedItems: {
      type: "array",
      description: "The COMPLETE corrected plan items tree with all fixes applied",
      items: buildItemSchema(),
    },
    corrections: {
      type: "array",
      description: "Log of every correction made",
      items: {
        type: "object",
        properties: {
          itemId: { type: "string", description: "ID of the affected item" },
          type: {
            type: "string",
            enum: ["inserted", "split", "renamed", "moved", "relevel", "reordered"],
            description: "Type of correction",
          },
          description: { type: "string", description: "What was changed and why" },
          agent: { type: "string", description: "Which step triggered this (Completeness Audit or Structure Validation)" },
        },
        required: ["itemId", "type", "description", "agent"],
      },
    },
    detectedLevels: {
      type: "array",
      description: "The corrected hierarchy levels after validation",
      items: {
        type: "object",
        properties: {
          depth: { type: "number" },
          name: { type: "string" },
        },
        required: ["depth", "name"],
      },
    },
  },
  required: ["correctedItems", "corrections", "detectedLevels"],
};

function flattenItems(items: unknown[], prefix = ""): string[] {
  const lines: string[] = [];
  for (const item of items) {
    const i = item as { id?: string; name?: string; levelType?: string; levelName?: string; children?: unknown[] };
    const id = i.id || "?";
    const name = i.name || "(unnamed)";
    const level = i.levelType || i.levelName || "?";
    lines.push(`${prefix}[${id}] (${level}) ${name}`);
    if (i.children?.length) {
      lines.push(...flattenItems(i.children, prefix + "  "));
    }
  }
  return lines;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ success: false, error: "Service configuration error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { sourceText, extractedItems, auditFindings, detectedLevels, sessionId: incomingSessionId, organizationName, industry, planLevels } = body;

    if (!extractedItems) {
      return new Response(JSON.stringify({ success: false, error: "extractedItems required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sessionId = await ensureSession(incomingSessionId);
    console.log("[validate-hierarchy] sessionId:", sessionId);

    let truncatedText = sourceText;
    if (sourceText.length > MAX_SOURCE_LENGTH) {
      truncatedText = sourceText.slice(0, MAX_SOURCE_LENGTH);
      console.log(`[validate-hierarchy] Source truncated from ${sourceText.length} to ${MAX_SOURCE_LENGTH}`);
    }

    const itemListing = flattenItems(extractedItems).join("\n");

    let contextPrefix = "";
    if (organizationName || industry || planLevels) {
      const parts: string[] = [];
      if (organizationName) parts.push(`Organization: ${organizationName}`);
      if (industry) parts.push(`Industry: ${industry}`);
      if (planLevels && Array.isArray(planLevels) && planLevels.length > 0) {
        const levelsList = planLevels.map((l: { depth: number; name: string }) => `Level ${l.depth}: ${l.name}`).join(', ');
        parts.push(`User-defined hierarchy (authoritative): ${levelsList}. Validate items against these levels.`);
      }
      contextPrefix = `ORGANIZATION CONTEXT:\n${parts.join("\n")}\n\n`;
    }

    // Build a prominent level enforcement section for the user message
    let levelEnforcementSection = "";
    if (planLevels && Array.isArray(planLevels) && planLevels.length > 0) {
      const levelNames = planLevels.map((l: { depth: number; name: string }) => l.name).join(", ");
      levelEnforcementSection = `\n=== USER-DEFINED PLAN LEVELS (MANDATORY) ===

The user has defined exactly ${planLevels.length} hierarchy levels: ${levelNames}.
Your output MUST have exactly ${planLevels.length} levels — no more, no less.

If the extracted items have MORE levels than ${planLevels.length}, you MUST collapse the hierarchy:
- Look for duplicate items at adjacent levels (parent-child pairs with the same or very similar names)
- When found, MERGE them: keep one copy, remove the duplicate, reassign the duplicate's children to the kept item
- If items were extracted at a depth beyond level ${planLevels.length}, re-assign them to the deepest user-defined level (${planLevels[planLevels.length - 1].name})

CRITICAL: Never create levels beyond what the user defined. If the user said ${planLevels.length} levels (${levelNames}), every item must be one of those levels. There should be no items beyond depth ${planLevels.length} in the output.
`;
    }

    let auditSection = "";
    if (auditFindings) {
      const af = auditFindings;
      const parts: string[] = [];
      if (af.missingItems?.length > 0) {
        parts.push(`MISSING ITEMS (${af.missingItems.length}):`);
        for (const m of af.missingItems) {
          parts.push(`  - "${m.sourceText}" [Level: ${m.suggestedLevel}] (Location: ${m.approximateLocation})`);
        }
      }
      if (af.mergedItems?.length > 0) {
        parts.push(`\nMERGED ITEMS (${af.mergedItems.length}):`);
        for (const m of af.mergedItems) {
          parts.push(`  - "${m.extractedItemName}" should be split into: ${m.originalItems.map((t: string) => `"${t}"`).join(", ")}`);
        }
      }
      if (af.rephrasedItems?.length > 0) {
        parts.push(`\nREPHRASED ITEMS (${af.rephrasedItems.length}):`);
        for (const r of af.rephrasedItems) {
          parts.push(`  - Extracted: "${r.extractedName}" → Original: "${r.originalText}"`);
        }
      }
      if (af.duplicateItems?.length > 0) {
        parts.push(`\nDUPLICATE ITEMS (${af.duplicateItems.length}):`);
        for (const d of af.duplicateItems) {
          parts.push(`  - "${d.item1Name}" (${d.item1Level || '?'}) ↔ "${d.item2Name}" (${d.item2Level || '?'}) — ${d.recommendation}`);
        }
      }
      if (parts.length > 0) {
        auditSection = `\n=== COMPLETENESS AUDIT FINDINGS ===\n${parts.join("\n")}\n`;
      }
    }

    let levelsSection = "";
    if (detectedLevels?.length > 0) {
      levelsSection = `\nDETECTED HIERARCHY LEVELS:\n${detectedLevels.map((l: { depth: number; name: string }) => `  Depth ${l.depth}: ${l.name}`).join("\n")}\n`;
    }

    let sourceSection = "";
    if (truncatedText && truncatedText.length > 50) {
      sourceSection = `\n=== SOURCE DOCUMENT ===\n\n${truncatedText}\n`;
    } else {
      sourceSection = `\n=== NOTE ===\nNo source text available (vision-only extraction). Validate hierarchy structure and level assignments based on the extracted items alone.\n`;
    }

    const userMessage = `${contextPrefix}=== EXTRACTED ITEMS ===

${itemListing}
${auditSection}${levelsSection}${levelEnforcementSection}${sourceSection}
Please validate and correct the hierarchy. Output the COMPLETE corrected items tree incorporating all audit findings. Document every correction.`;

    const requestBody = {
      model: "claude-sonnet-4-20250514",
      max_tokens: 16384,
      system: VALIDATION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
      tools: [{
        name: "submit_corrected_plan",
        description: "Submit the corrected and validated plan items with corrections log",
        input_schema: validateToolSchema,
      }],
      tool_choice: { type: "tool", name: "submit_corrected_plan" },
    };

    const startTime = Date.now();
    const response = await callAnthropicWithRetry("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
    const durationMs = Date.now() - startTime;

    // Build a log-safe version of the request (truncate large user messages)
    const logPayload = {
      ...requestBody,
      messages: requestBody.messages.map((msg: { role: string; content: string }) => ({
        ...msg,
        content: typeof msg.content === 'string' && msg.content.length > 10000
          ? msg.content.slice(0, 10000) + `\n[TRUNCATED: ${msg.content.length} chars total]`
          : msg.content,
      })),
    };

    if (!response.ok) {
      const errText = await response.text();
      console.error("[validate-hierarchy] Anthropic error:", response.status, errText);

      logApiCall({
        session_id: sessionId,
        edge_function: "validate-hierarchy",
        step_label: "Step 3: Structure Validation",
        model: "claude-sonnet-4-20250514",
        request_payload: logPayload,
        duration_ms: durationMs,
        status: "error",
        error_message: `Anthropic ${response.status}: ${errText.slice(0, 500)}`,
      });

      return new Response(JSON.stringify({ success: false, error: "Validation processing failed" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResponse = await response.json();
    const tokens = extractTokenUsage(aiResponse);

    const toolUse = aiResponse.content?.find((b: { type: string }) => b.type === "tool_use");

    logApiCall({
      session_id: sessionId,
      edge_function: "validate-hierarchy",
      step_label: "Step 3: Structure Validation",
      model: "claude-sonnet-4-20250514",
      request_payload: logPayload,
      response_payload: aiResponse,
      input_tokens: tokens.input_tokens,
      output_tokens: tokens.output_tokens,
      duration_ms: durationMs,
      status: toolUse ? "success" : "error",
      error_message: toolUse ? undefined : "No tool_use in response",
    });

    if (!toolUse) {
      return new Response(JSON.stringify({ success: false, error: "Validation returned unexpected format" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = toolUse.input;
    console.log("[validate-hierarchy] Corrections:", result.corrections?.length || 0, "items:", result.correctedItems?.length || 0);

    return new Response(JSON.stringify({ success: true, data: result, sessionId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[validate-hierarchy] Error:", error);
    return new Response(JSON.stringify({ success: false, error: "Validation failed" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
