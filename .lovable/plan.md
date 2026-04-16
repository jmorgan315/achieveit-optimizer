

## Settings Page Token Pricing Cleanup

Three cosmetic changes to `src/pages/admin/SettingsPage.tsx`:

1. **Read-only model names**: Replace the editable `Input` for model name with a plain text display showing a friendly name. Remove the "Add Model" button.

2. **Friendly display names**: Add a `MODEL_DISPLAY_NAMES` map:
   - `claude-opus-4-6` → "Claude Opus 4.6"
   - `claude-sonnet-4-20250514` → "Claude Sonnet 4"
   - Fallback: raw model string for any unmapped models

3. **Remove trash icons**: Drop the `Trash2` delete button column entirely. Adjust the grid from `grid-cols-[1fr_120px_120px_40px]` to `grid-cols-[1fr_120px_120px]`.

### Files

| File | Change |
|------|--------|
| `src/pages/admin/SettingsPage.tsx` | Add display name map, make model column read-only text, remove Add Model button, remove delete column |

