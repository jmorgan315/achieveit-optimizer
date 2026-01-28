import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { extractText } from "https://esm.sh/unpdf@0.12.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Validation constants
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_PAGES = 100;
const ALLOWED_MIME_TYPES = ['application/pdf'];

// Safe error helper - logs details server-side, returns generic message to client
function createSafeError(
  status: number,
  publicMessage: string,
  internalDetails?: unknown
): Response {
  if (internalDetails) {
    console.error('[PDF Parse Error]', {
      timestamp: new Date().toISOString(),
      details: internalDetails,
    });
  }
  return new Response(
    JSON.stringify({ success: false, error: publicMessage }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function extractTextFromPdf(pdfBuffer: ArrayBuffer): Promise<{ text: string; pageCount: number }> {
  const { text, totalPages } = await extractText(new Uint8Array(pdfBuffer));
  const fullText = Array.isArray(text) ? text.join('\n\n') : text;
  return { text: fullText, pageCount: totalPages };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const contentType = req.headers.get('content-type') || '';
    let pdfBuffer: ArrayBuffer;
    let fileSize = 0;

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File;

      if (!file) {
        return createSafeError(400, 'No file provided');
      }

      fileSize = file.size;

      // Validate file size
      if (fileSize > MAX_FILE_SIZE) {
        return createSafeError(413, 'File too large. Maximum 10MB allowed.');
      }

      // Validate file type
      if (file.type && !ALLOWED_MIME_TYPES.includes(file.type)) {
        return createSafeError(400, 'Invalid file type. Only PDF files are accepted.');
      }

      pdfBuffer = await file.arrayBuffer();
    } else if (contentType.includes('application/pdf')) {
      pdfBuffer = await req.arrayBuffer();
      fileSize = pdfBuffer.byteLength;

      if (fileSize > MAX_FILE_SIZE) {
        return createSafeError(413, 'File too large. Maximum 10MB allowed.');
      }
    } else if (contentType.includes('application/json')) {
      const body = await req.json();
      if (!body.pdf || typeof body.pdf !== 'string') {
        return createSafeError(400, 'No PDF data provided');
      }

      // Validate base64 size (base64 is ~33% larger than binary)
      const estimatedSize = (body.pdf.length * 3) / 4;
      if (estimatedSize > MAX_FILE_SIZE) {
        return createSafeError(413, 'File too large. Maximum 10MB allowed.');
      }

      const binaryString = atob(body.pdf);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      pdfBuffer = bytes.buffer;
    } else {
      return createSafeError(400, 'Unsupported content type. Use multipart/form-data, application/pdf, or application/json with base64 PDF.');
    }

    const { text, pageCount } = await extractTextFromPdf(pdfBuffer);

    // Validate page count
    if (pageCount > MAX_PAGES) {
      return createSafeError(413, `PDF too large. Maximum ${MAX_PAGES} pages allowed.`);
    }

    return new Response(
      JSON.stringify({ success: true, text, pageCount }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return createSafeError(500, 'Unable to process PDF. Please try again.', error);
  }
});
