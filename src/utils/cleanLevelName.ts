/**
 * Clean up AI-generated level names:
 * - Replace all underscores with spaces
 * - Apply Title Case
 * e.g. "action_item" → "Action Item", "strategy" → "Strategy"
 */
export function cleanLevelName(name: string): string {
  if (!name) return name;
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
