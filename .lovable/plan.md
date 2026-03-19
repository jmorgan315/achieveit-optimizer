

# Fix: Strip data URL prefix from base64 images in classify-document

## Problem
The `classify-document` edge function sends page images to Claude with the full data URL prefix (e.g., `data:image/jpeg;base64,/9j/4AAQ...`). Claude expects only raw base64 data. The function also hardcodes `media_type: "image/png"` even when images are JPEG.

## Fix (single file)
**`supabase/functions/classify-document/index.ts`**, lines 264-273

Replace the image-building loop to match the pattern used in `extract-plan-vision` (lines 796-803):

```typescript
for (let i = 0; i < pageImages.length; i++) {
  let base64Data = pageImages[i];
  let mediaType = "image/png";
  
  // Strip data URL prefix if present (e.g., "data:image/jpeg;base64,...")
  const match = base64Data.match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (match) {
    mediaType = match[1];
    base64Data = match[2];
  }
  
  userContent.push({
    type: "image",
    source: {
      type: "base64",
      media_type: mediaType,
      data: base64Data,
    },
  });
}
```

This extracts the actual media type from the data URL prefix and sends only the raw base64 string to Claude.

