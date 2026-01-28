import * as pdfjsLib from 'pdfjs-dist';

// Configure worker - use unpkg which has proper ESM support
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

export interface PDFPageImage {
  pageNumber: number;
  dataUrl: string;
  width: number;
  height: number;
}

export interface PDFRenderResult {
  images: PDFPageImage[];
  pageCount: number;
}

/**
 * Render PDF pages to images using PDF.js
 * @param file - The PDF file to render
 * @param maxPages - Maximum number of pages to render (default: 20)
 * @param scale - Render scale (default: 1.5 for good quality without huge size)
 */
export async function renderPDFToImages(
  file: File,
  maxPages: number = 20,
  scale: number = 1.0
): Promise<PDFRenderResult> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  
  const pageCount = pdf.numPages;
  const pagesToRender = Math.min(pageCount, maxPages);
  const images: PDFPageImage[] = [];

  for (let pageNum = 1; pageNum <= pagesToRender; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    // Create canvas
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    
    if (!context) {
      throw new Error('Failed to get canvas context');
    }

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    // Render page to canvas
    await page.render({
      canvasContext: context,
      viewport: viewport,
    }).promise;

    // Convert to data URL (JPEG for smaller size, lower quality for faster transfer)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.6);

    images.push({
      pageNumber: pageNum,
      dataUrl,
      width: viewport.width,
      height: viewport.height,
    });

    // Clean up
    canvas.remove();
  }

  return { images, pageCount };
}

/**
 * Check if extracted text quality is poor (fragmented, repetitive, or corrupt)
 * @param text - The extracted text to analyze
 * @param pageCount - Number of pages in the document
 */
export function isTextQualityPoor(text: string, pageCount: number): boolean {
  if (!text || text.trim().length === 0) {
    return true;
  }

  const trimmedText = text.trim();
  
  // Very short text for multi-page documents is suspicious
  const expectedMinChars = pageCount * 100; // Expect at least 100 chars per page
  if (trimmedText.length < expectedMinChars && pageCount > 1) {
    console.log('Text quality check: Too short for page count');
    return true;
  }

  // Check for repetitive patterns (common in corrupted PDFs)
  // Pattern: same short sequence repeated many times
  const repetitivePatterns = [
    /(\d{1,3}\s*){10,}/g,  // Repeated numbers like "20 20 20 20..."
    /(.{1,5})\1{10,}/g,    // Any short pattern repeated 10+ times
  ];
  
  for (const pattern of repetitivePatterns) {
    const matches = trimmedText.match(pattern);
    if (matches) {
      const repetitiveLength = matches.reduce((sum, m) => sum + m.length, 0);
      if (repetitiveLength > trimmedText.length * 0.3) {
        console.log('Text quality check: Too many repetitive patterns');
        return true;
      }
    }
  }

  // Check unique word ratio
  const words = trimmedText.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (words.length < 20) {
    console.log('Text quality check: Too few words');
    return true;
  }
  
  const uniqueWords = new Set(words);
  const uniqueRatio = uniqueWords.size / words.length;
  
  // Very low unique ratio suggests repetitive/corrupt content
  if (uniqueRatio < 0.15) {
    console.log(`Text quality check: Low unique word ratio (${uniqueRatio.toFixed(2)})`);
    return true;
  }

  // Check for meaningful content indicators
  const meaningfulTerms = [
    /strategic|priority|objective|goal|initiative|plan/i,
    /target|metric|kpi|measure|outcome/i,
    /strategy|action|task|milestone/i,
  ];
  
  const hasMeaningfulContent = meaningfulTerms.some(pattern => pattern.test(trimmedText));
  
  // If no meaningful strategic planning terms and text is short, quality is poor
  if (!hasMeaningfulContent && trimmedText.length < 500) {
    console.log('Text quality check: No meaningful strategic terms found');
    return true;
  }

  return false;
}

/**
 * Batch page images for API calls (to stay within token limits)
 * @param images - Array of page images
 * @param batchSize - Number of pages per batch (default: 3)
 */
export function batchPageImages(
  images: PDFPageImage[],
  batchSize: number = 3
): PDFPageImage[][] {
  const batches: PDFPageImage[][] = [];
  
  for (let i = 0; i < images.length; i += batchSize) {
    batches.push(images.slice(i, i + batchSize));
  }
  
  return batches;
}
