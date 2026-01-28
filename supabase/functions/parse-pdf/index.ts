import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { extractText } from "https://esm.sh/unpdf@0.12.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function extractTextFromPdf(pdfBuffer: ArrayBuffer): Promise<{ text: string; pageCount: number }> {
  const { text, totalPages } = await extractText(new Uint8Array(pdfBuffer));
  
  // text is an array of strings (one per page), join them
  const fullText = Array.isArray(text) ? text.join('\n\n') : text;
  
  return {
    text: fullText,
    pageCount: totalPages
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
