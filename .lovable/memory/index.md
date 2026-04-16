# Memory: index.md
Updated: just now

# Project Memory

## Core
Auth strictly restricted to '@achieveit.com' via Email/Password. No anonymous access.
AchieveIt Branding: Primary green/blue/orange, Poppins font. Logo functions as universal Home.
Terminology: Always use 'Assigned To' in UI, but 'owner' for internal code/DB references.
Architecture: Supabase Edge Functions proxy AI services (Claude 4.6/Sonnet, Gemini 1.5).
Security: Service role key used in backend to bypass RLS. Strict character limits on AI context fields.
Processing Limits: Max 250 pages for PDF, 10MB file, 8MB for text extraction, 300k chars total.
Vision Limits: Must strip data URL prefixes (e.g., 'data:image/jpeg;base64,') for Anthropic API.
Export Format: Strictly 18 columns, sequential order strings (1.1.1), M/D/YY dates, email-only Assignment.
Roles: Three-tier (user/admin/super_admin). User mgmt actions require super_admin.
Email: Resend connector via gateway; opt-out flag user_profiles.feature_flags.email_notifications.

## Memories
- [Project Overview](mem://project/overview) — Enterprise strategy middleware for extracting unstructured plans
- [Plan Structure](mem://logic/plan-structure) — Recursive document-agnostic hierarchy with auto-calculated order strings (e.g. 1.1.1)
- [File Input](mem://constraints/file-input) — Support and limits for PDF, Excel, CSV, Word, and Text files
- [Branding](mem://style/branding) — AchieveIt brand colors, Poppins font, and global header configuration
- [Security Limits](mem://constraints/security) — Strict auth domain and character limits on AI context fields
- [Performance Specs](mem://constraints/performance) — Chunking/batching rules for extraction and polling limits
- [Organization Profiling](mem://features/organization-profiling) — Quick scan with client-side images, excludes text extraction
- [Wizard Navigation](mem://features/wizard-navigation) — 5-step flow from Recent Sessions to Review & Export
- [Processing Overlay](mem://features/processing-overlay) — Unified 5-step UI overlay during active processing
- [Vision Input Constraints](mem://constraints/vision-input) — Requirements for stripping data URL prefixes for Anthropic API
- [Rephrased Item Handling](mem://logic/rephrased-item-handling) — Programmatic reversion of AI-rephrased names via audit/validation cycles
- [Specialized Extraction](mem://logic/specialized-extraction) — Table vs presentation mode prompt strategies
- [Spreadsheet Import](mem://features/spreadsheet-import) — Cross-sheet merge and mapping rules (Strategy > Outcome > Action > Measurement)
- [Deduplication](mem://logic/deduplication) — Parent-aware fuzzy matching, exact/50-char/95% overlap rules
- [Classification Guidance](mem://logic/classification-guidance) — Agent 0 tabular vs text_heavy doc classification rules
- [Page Range Parsing](mem://logic/page-range-parsing) — Non-contiguous page selections bypass text-only path
- [Orchestrator Timing](mem://infrastructure/orchestrator-timing) — 150s execution window, 120s self-chaining threshold
- [Recent Sessions](mem://features/recent-sessions) — Landing page polling and resume state hydration
- [Admin Dashboard](mem://features/admin-dashboard) — Global session oversight, token cost calculations, user reassignment
- [Resumable Pipeline](mem://infrastructure/resumable-pipeline) — Persist step_results, pipeline_run_id ownership checks
- [Time Estimation](mem://logic/time-estimation) — Dynamic calculation: 4s/page tabular, 3s/page text + overhead buffers
- [AI Extraction Batching](mem://features/ai-extraction) — Agent 3 batched validation for >75 items, max 32k tokens
- [Cloud Backend Stack](mem://infrastructure/cloud-backend) — Anthropic/Gemini model usage across the agent stack
- [Admin Roles](mem://auth/admin-roles) — Three-tier role system (user/admin/super_admin), super_admin gates user mgmt
- [User Identity](mem://features/user-identity) — Splitting user names for UI display instead of email addresses
- [Edge Function Auth](mem://infrastructure/edge-function-auth-pattern) — Custom auth with expanded CORS headers bypassing platform JWT
- [Naming Conventions](mem://terminology/naming-conventions) — Mapping "Assigned To" in UI to "owner" in codebase
- [People Mapper](mem://features/people-mapper) — Resolving names/departments to valid emails for assignments
- [Export Logic Formatting](mem://features/export-logic) — 18-column AchieveIt format generation with mandatory fields
- [Item Editing Fields](mem://features/item-editing) — Parity with export columns, specific dropdown values for status/frequency
- [Confidence UI](mem://features/confidence-ui) — 20-100 tier system for tracking structural fixes and rephrases
- [Dedup Review Logic](mem://features/dedup-review) — Tiered matching strategy to restore/dismiss removed items
- [Completeness Audit](mem://logic/completeness-audit) — Step 2 logic preventing conflicts with intentionally deduplicated items
- [Database Security RLS](mem://infrastructure/database-security) — Multi-tenancy RLS policies on sessions and storage buckets
- [Persistence Format](mem://logic/persistence-format) — `format: planItem` marker bypassing legacy snake_case mapping
- [Hierarchy Assignment](mem://logic/hierarchy-assignment) — Manual vs dynamic level definitions and reordering logic
- [Feedback System](mem://features/feedback-system) — Rating system leveraging original actual_item_count for unbiased scoring
- [General Feedback](mem://features/general-feedback) — Header feedback button for bug reports/feature requests gated by showFeedback flag
- [Feature Flags](mem://features/feature-flags) — JSONB flags gated per-user by administrators
- [Email Notifications](mem://features/email-notifications) — Resend-powered terminal-status emails with per-user opt-out toggle
