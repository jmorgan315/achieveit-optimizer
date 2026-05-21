// TEMPORARY — Phase 4c.2a Stage A audit. Deleted at end of stage.
// Downloads the source xlsx from storage, builds workbookPreview the same
// shape FileUploadStep does, invokes classify-spreadsheet-layout with
// dryRun=true, returns the merged result alongside the saved baseline.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PREVIEW_MAX_ROWS = 30;
const PREVIEW_MAX_COLS = 12;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { sessionId } = await req.json();
    if (!sessionId) {
      return json({ error: "sessionId required" }, 400);
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: session, error: sErr } = await supabase
      .from("processing_sessions")
      .select("id, document_name, source_file_path, org_name, document_hints, layout_classification")
      .eq("id", sessionId)
      .single();
    if (sErr || !session) return json({ error: "session not found", details: sErr?.message }, 404);
    if (!session.source_file_path) return json({ error: "session has no source_file_path" }, 400);

    const { data: fileBlob, error: dlErr } = await supabase.storage
      .from("source-documents")
      .download(session.source_file_path);
    if (dlErr || !fileBlob) return json({ error: "download failed", details: dlErr?.message }, 500);

    const buffer = await fileBlob.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });

    const workbookPreview = workbook.SheetNames.flatMap((name) => {
      const ws = workbook.Sheets[name];
      if (!ws?.["!ref"]) return [];
      const json = (XLSX.utils.sheet_to_json(ws, {
        header: 1,
        defval: null,
        blankrows: false,
      }) as (string | number | null)[][]).filter((row): row is (string | number | null)[] => Array.isArray(row));
      return [{
        sheetName: name,
        rows: json.slice(0, PREVIEW_MAX_ROWS).map((r) => r.slice(0, PREVIEW_MAX_COLS)),
      }];
    });

    // Invoke classifier with dryRun
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/classify-spreadsheet-layout`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        sessionId,
        orgName: session.org_name,
        documentHints: session.document_hints,
        workbookPreview,
        dryRun: true,
      }),
    });
    const classifyBody = await resp.json();

    return json({
      sessionId,
      document_name: session.document_name,
      sheetNames: workbookPreview.map((s) => s.sheetName),
      baseline: session.layout_classification,
      replay: classifyBody?.data ?? classifyBody,
    });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
