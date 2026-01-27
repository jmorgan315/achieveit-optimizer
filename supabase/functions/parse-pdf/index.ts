import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import * as pdfjs from "https://esm.sh/pdfjs-dist@4.0.379/build/pdf.min.mjs";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Use fake worker for Deno environment
pdfjs.GlobalWorkerOptions.workerSrc = "";

async function extractTextFromPdf(pdfBuffer: ArrayBuffer): Promise<{ text: string; pageCount: number }> {
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(pdfBuffer) });
  const pdf = await loadingTask.promise;
  
  const textParts: string[] = [];
  
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: { str?: string }) => item.str || '')
      .join(' ');
    textParts.push(pageText);
  }
  
  return {
    text: textParts.join('\n\n'),
    pageCount: pdf.numPages
  };
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const contentType = req.headers.get('content-type') || '';
    
    let pdfBuffer: ArrayBuffer;
    
    if (contentType.includes('multipart/form-data')) {
      // Handle form data upload
      const formData = await req.formData();
      const file = formData.get('file') as File;
      
      if (!file) {
        return new Response(
          JSON.stringify({ success: false, error: 'No file provided' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      pdfBuffer = await file.arrayBuffer();
    } else if (contentType.includes('application/pdf')) {
      // Handle raw PDF upload
      pdfBuffer = await req.arrayBuffer();
    } else if (contentType.includes('application/json')) {
      // Handle base64 encoded PDF
      const body = await req.json();
      if (!body.pdf) {
        return new Response(
          JSON.stringify({ success: false, error: 'No PDF data provided' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Decode base64
      const binaryString = atob(body.pdf);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      pdfBuffer = bytes.buffer;
    } else {
      return new Response(
        JSON.stringify({ success: false, error: 'Unsupported content type. Use multipart/form-data, application/pdf, or application/json with base64 PDF' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { text, pageCount } = await extractTextFromPdf(pdfBuffer);

    return new Response(
      JSON.stringify({
        success: true,
        text,
        pageCount,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('PDF parsing error:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to parse PDF',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
