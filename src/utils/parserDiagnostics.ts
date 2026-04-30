/**
 * Server-side parser diagnostics logger.
 *
 * Writes structured diagnostic data to the `parser_diagnostics` table so it
 * can be inspected from the admin Layout Classification panel. This is the
 * standard pattern for any parser-side instrumentation going forward —
 * prefer this over console.log for anything we want to capture across the
 * multi-step wizard flow.
 *
 * Design rules:
 *  - Never throw. Diagnostic logging must NEVER break the parser.
 *  - Fire-and-forget; callers don't need to await unless they want to.
 */

import { supabase } from '@/integrations/supabase/client';

export type ParserName =
  | 'parseHierarchicalColumns'
  | 'dispatcher'
  | string;

export type ParserLogType =
  | 'entry'
  | 'route'
  | 'dispatch'
  | 'resolve-levels'
  | 'row-scan-start'
  | 'row-scan-summary'
  | 'skipped-samples'
  | 'root-summary'
  | 'parsed'
  | 'hierarchy'
  | 'useEffect-post-detect'
  | string;

export async function logParserDiagnostic(
  sessionId: string | null | undefined,
  parserName: ParserName,
  logType: ParserLogType,
  payload: Record<string, unknown>,
  sheetName?: string | null,
): Promise<void> {
  if (!sessionId) return; // No session context → nothing to anchor against.
  try {
    const { error } = await supabase.from('parser_diagnostics').insert({
      session_id: sessionId,
      sheet_name: sheetName ?? null,
      parser_name: parserName,
      log_type: logType,
      payload: payload as never,
    });
    if (error) {
      // eslint-disable-next-line no-console
      console.error('[parser-diag] insert error:', error.message);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[parser-diag] failed to log:', err);
  }
}
