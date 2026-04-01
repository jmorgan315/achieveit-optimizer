

# Redeploy Edge Functions to Match Rolled-Back Repo

## Situation

The Lovable rollback restored the frontend code but edge functions deploy independently — the deployed versions on the server still have Phase 1 large-document changes (multi-entity prompts, chunked classification, pipeline_run_id, retry logic).

The repo files are already correct (pre-Phase 1). I verified: no matches for `pipeline_run_id`, `multi-entity`, or `chunked classif` in the current `supabase/functions/` directory.

## Fix

Redeploy these four edge functions from the current repo state:

1. **extract-plan-vision** — overwrites deployed version that has multi-entity prompt additions
2. **extract-plan-items** — overwrites deployed version that has multi-entity prompt additions  
3. **validate-hierarchy** — overwrites deployed version that has multi-entity prompt additions
4. **process-plan** — overwrites deployed version that has chunked classification and pipeline_run_id

No code changes needed — just a deploy of the existing repo files to sync the server with the rolled-back codebase.

## Technical Detail

Will call `supabase--deploy_edge_functions` with all four function names simultaneously, then verify via logs that the deployed versions are running correctly.

