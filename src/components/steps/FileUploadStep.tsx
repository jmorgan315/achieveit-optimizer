import { useState, useRef, useCallback } from 'react';
import { DedupRemovedDetail } from '@/types/plan';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Upload, FileText, CheckCircle2, Loader2, AlertTriangle, ClipboardPaste } from 'lucide-react';
import { SAMPLE_RAW_TEXT, PlanItem, PersonMapping, PlanLevel, DEFAULT_LEVELS } from '@/types/plan';
import { toast } from '@/hooks/use-toast';
import { getUserFriendlyError } from '@/utils/getUserFriendlyError';
import { AIExtractionResponse, convertAIResponseToPlanItems } from '@/utils/textParser';
import { cleanLevelName } from '@/utils/cleanLevelName';
import { renderPDFToImages } from '@/utils/pdfToImages';
import { ProcessingOverlay, ProcessingStep } from './ProcessingOverlay';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';
import { Textarea } from '@/components/ui/textarea';

import { OrgProfile } from '@/types/plan';
import { SpreadsheetImportStep } from './SpreadsheetImportStep';

interface FileUploadStepProps {
  onTextSubmit: (text: string) => void;
  onAIExtraction?: (items: PlanItem[], personMappings: PersonMapping[], levels: PlanLevel[]) => void;
  onSpreadsheetComplete?: (items: PlanItem[], personMappings: PersonMapping[], levels: PlanLevel[]) => void;
  orgProfile?: OrgProfile;
  sessionId?: string;
  hasExistingItems?: boolean;
  onAdvanceExisting?: () => void;
  // Lifted state
  uploadedFile: File | null; setUploadedFile: (v: File | null) => void;
  fileContent: string; setFileContent: (v: string) => void;
  extractedItems: PlanItem[] | null; setExtractedItems: (v: PlanItem[] | null) => void;
  extractedMappings: PersonMapping[] | null; setExtractedMappings: (v: PersonMapping[] | null) => void;
  detectedLevels: PlanLevel[] | null; setDetectedLevels: (v: PlanLevel[] | null) => void;
  useVisionAI: boolean; setUseVisionAI: (v: boolean) => void;
  dedupResults: DedupRemovedDetail[]; setDedupResults: (v: DedupRemovedDetail[]) => void;
  pageImages?: string[] | null; setPageImages?: (v: string[] | null) => void;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

interface ProgressState {
  currentStep: ProcessingStep;
  stepProgress: number;
  messages: string[];
}

const INITIAL_PROGRESS: ProgressState = {
  currentStep: 'upload',
  stepProgress: 0,
  messages: [],
};

const CHARS_PER_PAGE_THRESHOLD = 200;
const MAX_PDF_PAGES = 250;

export function FileUploadStep({
  onTextSubmit, onAIExtraction, onSpreadsheetComplete, orgProfile, sessionId,
  hasExistingItems, onAdvanceExisting,
  uploadedFile, setUploadedFile,
  fileContent, setFileContent,
  extractedItems, setExtractedItems,
  extractedMappings, setExtractedMappings,
  detectedLevels, setDetectedLevels,
  useVisionAI, setUseVisionAI,
  dedupResults, setDedupResults,
  pageImages, setPageImages,
}: FileUploadStepProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [spreadsheetFile, setSpreadsheetFile] = useState<File | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const [visionError, setVisionError] = useState<string | null>(null);
  const [pasteMode, setPasteMode] = useState(false);
  const [pastedText, setPastedText] = useState('');
  const [pageCountError, setPageCountError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [progressState, setProgressState] = useState<ProgressState>(INITIAL_PROGRESS);

  const addMessage = useCallback((msg: string) => {
    setProgressState(prev => ({
      ...prev,
      messages: [...prev.messages, msg],
    }));
    setProcessingStatus(msg);
  }, []);

  const setStepProgress = useCallback((currentStep: ProcessingStep, stepProgress: number) => {
    setProgressState(prev => ({
      ...prev,
      currentStep,
      stepProgress,
    }));
  }, []);

  const resetProgress = useCallback(() => {
    setProgressState(INITIAL_PROGRESS);
  }, []);

  const updateSessionRow = async (updates: Record<string, unknown>) => {
    if (!sessionId) return;
    try {
      const { error } = await supabase.from('processing_sessions').update(updates).eq('id', sessionId);
      if (error) console.error('[FileUpload] Session update error:', error);
    } catch (e) {
      console.error('[FileUpload] Failed to update session:', e);
    }
  };

  const aggregateAndUpdateSession = async (itemCount: number, method: string) => {
    if (!sessionId) return;
    try {
      const { data: logs, error: logsError } = await supabase
        .from('api_call_logs')
        .select('input_tokens, output_tokens, duration_ms')
        .eq('session_id', sessionId);

      if (logsError) console.error('[FileUpload] Failed to fetch logs:', logsError);
      
      const totals = (logs || []).reduce(
        (acc, row) => ({
          total_api_calls: acc.total_api_calls + 1,
          total_input_tokens: acc.total_input_tokens + (row.input_tokens || 0),
          total_output_tokens: acc.total_output_tokens + (row.output_tokens || 0),
          total_duration_ms: acc.total_duration_ms + (row.duration_ms || 0),
        }),
        { total_api_calls: 0, total_input_tokens: 0, total_output_tokens: 0, total_duration_ms: 0 }
      );

      await updateSessionRow({
        ...totals,
        extraction_method: method,
        total_items_extracted: itemCount,
        status: 'completed',
      });
    } catch (e) {
      console.error('[FileUpload] Failed to aggregate session:', e);
    }
  };

  const parsePdfWithEdgeFunction = async (file: File): Promise<{ text: string; pageCount: number }> => {
    addMessage('Uploading document...');
    setStepProgress('upload', 30);
    
    const formData = new FormData();
    formData.append('file', file);
    if (sessionId) formData.append('sessionId', sessionId);

    updateSessionRow({ document_name: file.name, document_size_bytes: file.size });

    const response = await fetch(`${SUPABASE_URL}/functions/v1/parse-pdf`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to parse PDF');
    }

    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || 'PDF parsing failed');
    }

    addMessage('Document uploaded successfully');
    setStepProgress('upload', 100);
    return { text: result.text, pageCount: result.pageCount };
  };

  /** If no item has a confidence score AND pipeline didn't run, apply fallback defaults */
  const applyFallbackConfidence = (items: PlanItem[], pipelineComplete?: boolean) => {
    if (pipelineComplete) return;
    const walk = (list: PlanItem[]) => {
      for (const item of list) {
        if (item.confidence == null) {
          item.confidence = 50;
          item.corrections = [
            ...(item.corrections || []),
            'Single-pass extraction only — completeness audit and hierarchy validation did not run.',
          ];
        }
        if (item.children?.length) walk(item.children);
      }
    };
    const hasAny = items.some(function check(i): boolean {
      return i.confidence != null || (i.children?.some(check) ?? false);
    });
    if (!hasAny) walk(items);
  };

  // Poll processing_sessions for async pipeline results
  const pollForResults = async (pollSessionId: string): Promise<{
    success: boolean;
    data?: any;
    totalItems?: number;
    corrections?: any[];
    sessionConfidence?: number;
    auditSummary?: any;
    extractionMethod?: string;
    pipelineComplete?: boolean;
    dedupResults?: DedupRemovedDetail[];
    error?: string;
  }> => {
    const POLL_INTERVAL = 3000;
    const MAX_POLLS = 800; // ~40 minutes max for large documents
    const MAX_RESUMES = 20;

    let lastReportedStep = '';
    let extractionCompleteAt: number | null = null;
    let resumeCount = 0;

    // Extraction-phase stall detection
    let lastBatchCount: number | null = null;
    let batchStallStart: number | null = null;

    // Progress high-water mark — never let the bar go backwards
    const highWaterProgress: Record<string, number> = {};
    const setStepProgressHWM = (step: ProcessingStep, pct: number) => {
      const prev = highWaterProgress[step] || 0;
      if (pct >= prev) {
        highWaterProgress[step] = pct;
        setStepProgress(step, pct);
      }
    };

    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));

      const { data: session, error } = await supabase
        .from('processing_sessions')
        .select('status, current_step, step_results')
        .eq('id', pollSessionId)
        .single();

      if (error) {
        console.error('[Polling] Error:', error);
        continue;
      }

      if (!session) continue;

      // Update UI based on current_step — only add a message when the step changes
      const step = (session as any).current_step as string;
      const stepResults = (session as any).step_results as any;

      if (step && step !== lastReportedStep) {
        lastReportedStep = step;
        // Reset post-extraction stall timer on any step transition
        extractionCompleteAt = null;
        if (step === 'classifying') {
          setStepProgressHWM('classify', 50);
          addMessage('Classifying document structure...');
        } else if (step === 'extracting') {
          setStepProgressHWM('extract', 50);
          addMessage('Extracting plan items...');
        } else if (step === 'extraction_complete') {
          setStepProgressHWM('extract', 100);
          addMessage('Extraction complete, starting audit...');
        } else if (step === 'auditing') {
          setStepProgressHWM('validate', 25);
          addMessage('Running completeness audit...');
        } else if (step === 'audited') {
          setStepProgressHWM('validate', 50);
          addMessage('Audit complete, starting validation...');
        } else if (step === 'validating') {
          setStepProgressHWM('validate', 75);
          addMessage('Validating hierarchy...');
        }
      }

      // Show batch progress during extraction
      if (step === 'extracting' && stepResults?.extraction) {
        const batchesCompleted = stepResults.extraction.batches_completed || 0;
        const batchesTotal = stepResults.extraction.batches_total || 0;
        if (batchesTotal > 1 && batchesCompleted > 0) {
          const pct = Math.round((batchesCompleted / batchesTotal) * 100);
          setStepProgressHWM('extract', Math.min(pct, 95));
        }
      }

      // Skip stall detection if session already finished
      if (session.status === 'completed' || session.status === 'error') {
        // fall through to the status checks below
      } else {
        // Extraction-phase stall detection: if batches_completed unchanged for >30s
        if (step === 'extracting') {
          const currentBatchCount = stepResults?.extraction?.batches_completed ?? null;
          if (currentBatchCount !== null) {
            if (lastBatchCount !== null && currentBatchCount === lastBatchCount) {
              if (!batchStallStart) {
                batchStallStart = Date.now();
              }
              const stallDuration = Date.now() - batchStallStart;
              if (stallDuration > 120000 && resumeCount < MAX_RESUMES) {
                resumeCount++;
                batchStallStart = null; // re-arm stall timer
                console.log(`[Polling] Resume attempt ${resumeCount} of ${MAX_RESUMES} — extraction stall (batch ${currentBatchCount} unchanged for ${Math.round(stallDuration / 1000)}s)`);
                addMessage(`Processing large document... (continuation ${resumeCount})`);
                try {
                  await fetch(`${SUPABASE_URL}/functions/v1/process-plan`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ resume_session_id: pollSessionId }),
                  });
                } catch (resumeErr) {
                  console.error('[Polling] Extraction resume call failed:', resumeErr);
                }
              }
            } else {
              // Batch count changed — reset stall timer
              lastBatchCount = currentBatchCount;
              batchStallStart = null;
            }
          }
        }

        // Post-extraction stall detection: covers all states after extraction
        const postExtractionStallStates = ['extraction_complete', 'auditing', 'audited', 'validating'];
        if (postExtractionStallStates.includes(step)) {
          if (!extractionCompleteAt) {
            extractionCompleteAt = Date.now();
          }
          // 120s for states where an agent is actively running, 20s for idle states
          const agentRunning = step === 'auditing' || step === 'validating';
          const threshold = agentRunning ? 120000 : 20000;
          const stallDuration = Date.now() - extractionCompleteAt;
          if (stallDuration > threshold && resumeCount < MAX_RESUMES) {
            resumeCount++;
            extractionCompleteAt = null; // re-arm stall timer
            console.log(`[Polling] Resume attempt ${resumeCount} of ${MAX_RESUMES} — post-extraction stall at '${step}' (${Math.round(stallDuration / 1000)}s)`);
            addMessage(`Finalizing analysis... (continuation ${resumeCount})`);
            try {
              await fetch(`${SUPABASE_URL}/functions/v1/process-plan`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resume_session_id: pollSessionId }),
              });
            } catch (resumeErr) {
              console.error('[Polling] Resume call failed:', resumeErr);
            }
          }
        } else if (step !== 'extracting') {
          extractionCompleteAt = null;
        }

        // Max resume guard
        if (resumeCount >= MAX_RESUMES) {
          console.warn(`[Polling] Reached max resume limit (${MAX_RESUMES}), falling through to partial results`);
          break;
        }
      }

      if (session.status === 'completed') {
        const results = (session as any).step_results as any;
        if (results) return results;
        return { success: false, error: 'Completed but no results found' };
      }

      if (session.status === 'error') {
        const results = (session as any).step_results as any;
        throw new Error(results?.error || 'Pipeline failed');
      }
    }

    // Timeout fallback: check for partial extraction results
    console.log('[Polling] MAX_POLLS reached, checking for partial results...');
    const { data: finalSession } = await supabase
      .from('processing_sessions')
      .select('step_results, current_step')
      .eq('id', pollSessionId)
      .single();

    const partialResults = (finalSession as any)?.step_results as any;
    if (partialResults?.extraction?.items?.length > 0) {
      const batchesCompleted = partialResults.extraction.batches_completed || 0;
      const batchesTotal = partialResults.extraction.batches_total || 0;
      const isPartialExtraction = batchesTotal > 0 && batchesCompleted < batchesTotal;
      
      console.log(`[Polling] Found partial extraction results (${partialResults.extraction.items.length} items, ${batchesCompleted}/${batchesTotal} batches), using as fallback`);
      const items = partialResults.extraction.items;
      const levels = partialResults.extraction.detectedLevels || [];
      toast({
        title: "Partial Results",
        description: isPartialExtraction
          ? `Extraction partially complete (${batchesCompleted} of ${batchesTotal} batches) — some items may be missing.`
          : "Extraction complete but validation timed out — results may need manual review.",
      });
      return {
        success: true,
        data: { items, detectedLevels: levels },
        totalItems: countAllItems(items),
        extractionMethod: 'vision',
        pipelineComplete: false,
      };
    }

    throw new Error('Pipeline timed out after 10 minutes');
  };

  const extractWithVisionPipeline = async (
    file: File,
    _levelHints?: PlanLevel[],
    documentText?: string,
  ): Promise<{ items: PlanItem[]; levels: PlanLevel[]; personMappings: PersonMapping[]; sessionConfidence?: number } | null> => {
    setIsExtracting(true);
    setUseVisionAI(true);
    setStepProgress('extract', 0);
    addMessage('Extracting plan items...');

    try {
      const pageRange = orgProfile?.pageRange;
      let images: { dataUrl: string; pageNumber: number; width: number; height: number }[];
      let pageCount: number;

      // Use pre-rendered images from quick scan if available
      if (pageImages && pageImages.length > 0) {
        images = pageImages.map((url, idx) => ({ dataUrl: url, pageNumber: idx + 1, width: 0, height: 0 }));
        pageCount = pageImages.length;
        console.log(`[Vision] Using ${images.length} pre-rendered images from quick scan`);
      } else {
        const rendered = await renderPDFToImages(file, 250, 0.75, pageRange);
        images = rendered.images;
        pageCount = rendered.pageCount;
        if (setPageImages) {
          setPageImages(images.map(i => i.dataUrl));
        }
      }

      // Check page count limit
      if (pageCount > MAX_PDF_PAGES) {
        setPageCountError(`This document has ${pageCount} pages. The current limit is ${MAX_PDF_PAGES} pages. Try uploading only the section that contains your strategic plan, or use Document Scope to narrow the page range.`);
        setFileContent('');
        setIsExtracting(false);
        setIsProcessing(false);
        return null;
      }

      const imageSizes = images.map(img => Math.round(img.dataUrl.length * 0.75 / 1024));
      const totalKB = imageSizes.reduce((s, k) => s + k, 0);
      const avgKB = Math.round(totalKB / images.length);
      console.log(`[Vision] Rendered ${images.length} pages, avg ${avgKB}KB/page, total ${(totalKB / 1024).toFixed(1)}MB`);
      addMessage(`Rendered ${images.length} pages (avg ${avgKB}KB each)`);

      setStepProgress('upload', 100);
      addMessage('Document prepared');

      setStepProgress('classify', 0);
      addMessage('Starting AI pipeline...');

      // Fire off process-plan (returns immediately with sessionId)
      const response = await fetch(`${SUPABASE_URL}/functions/v1/process-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageImages: images.map(img => img.dataUrl),
          documentText: documentText || "",
          organizationName: orgProfile?.organizationName,
          industry: orgProfile?.industry,
          documentHints: orgProfile?.documentHints,
          planLevels: orgProfile?.planLevels,
          pageRange: orgProfile?.pageRange,
          sessionId,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to start pipeline');
      }

      const initResult = await response.json();
      if (!initResult.success) {
        throw new Error(initResult.error || 'Failed to start pipeline');
      }

      const pipelineSessionId = initResult.sessionId || sessionId;
      addMessage('Pipeline started, monitoring progress...');

      // Poll for results
      const result = await pollForResults(pipelineSessionId);

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Extraction returned no data');
      }

      setStepProgress('extract', 100);
      addMessage(`Extraction complete — found ${result.totalItems || 0} items`);

      setStepProgress('audit', 100);
      addMessage('Audit complete');

      setStepProgress('validate', 100);
      addMessage('Validation complete');

      const aiResponse: AIExtractionResponse = result.data;
      const totalItems = result.totalItems || 0;
      const sessionConfidence = result.sessionConfidence;

      const levels: PlanLevel[] = aiResponse.detectedLevels?.length > 0
        ? aiResponse.detectedLevels.map((l, idx) => ({
            id: String(idx + 1),
            name: cleanLevelName(l.name),
            depth: l.depth,
          }))
        : DEFAULT_LEVELS;

      const { items, personMappings } = convertAIResponseToPlanItems(aiResponse, levels);
      applyFallbackConfidence(items, result.pipelineComplete);

      toast({
        title: "Extraction Complete",
        description: `Found ${totalItems} plan items`,
      });

      const visionDedupData = result.dedupResults || [];
      setDedupResults(visionDedupData);

      return { items, levels, personMappings, sessionConfidence };

    } catch (error: any) {
      console.error('Vision pipeline error:', error);
      const errorMessage = error?.message || String(error);
      
      if (sessionId) {
        try {
          await supabase.from('api_call_logs').insert({
            session_id: sessionId,
            edge_function: 'process-plan',
            step_label: 'Vision extraction failed',
            status: 'error',
            error_message: errorMessage,
          });
          await supabase.from('processing_sessions').update({ status: 'failed' }).eq('id', sessionId);
        } catch (logErr) {
          console.error('[Vision] Failed to log error:', logErr);
        }
      }

      setVisionError(errorMessage);
      toast({
        title: "Extraction Failed",
        description: "This document couldn't be processed automatically. You can paste the plan text instead.",
        variant: "destructive",
      });
      return null;
    } finally {
      setIsExtracting(false);
    }
  };

  const extractPlanItemsWithAI = async (text: string): Promise<{ items: PlanItem[]; levels: PlanLevel[]; personMappings: PersonMapping[]; sessionConfidence?: number } | null> => {
    setIsExtracting(true);
    setStepProgress('extract', 0);
    addMessage('Extracting plan items...');

    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/process-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          documentText: text,
          organizationName: orgProfile?.organizationName,
          industry: orgProfile?.industry,
          documentHints: orgProfile?.documentHints,
          planLevels: orgProfile?.planLevels,
          pageRange: orgProfile?.pageRange,
          sessionId,
        }),
      });

      setStepProgress('extract', 20);

      if (!response.ok) {
        const error = await response.json();
        if (response.status === 429) throw new Error('AI rate limit reached. Please wait a moment and try again.');
        if (response.status === 402) throw new Error('AI credits exhausted. Please add credits to continue.');
        throw new Error(error.error || 'Failed to start pipeline');
      }

      const initResult = await response.json();
      if (!initResult.success) {
        throw new Error(initResult.error || 'Failed to start pipeline');
      }

      const pipelineSessionId = initResult.sessionId || sessionId;
      addMessage('Pipeline started, monitoring progress...');

      // Poll for results
      const result = await pollForResults(pipelineSessionId);

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Extraction returned no data');
      }

      setStepProgress('extract', 100);
      addMessage(`Extraction complete — found ${result.totalItems || 0} items`);

      setStepProgress('audit', 100);
      addMessage('Audit complete');

      setStepProgress('validate', 100);
      addMessage('Validation complete');

      const aiResponse: AIExtractionResponse = result.data;
      const totalItems = result.totalItems || 0;
      const sessionConfidence = result.sessionConfidence;

      const levels: PlanLevel[] = aiResponse.detectedLevels?.length > 0
        ? aiResponse.detectedLevels.map((l, idx) => ({
            id: String(idx + 1),
            name: cleanLevelName(l.name),
            depth: l.depth,
          }))
        : DEFAULT_LEVELS;

      const { items, personMappings } = convertAIResponseToPlanItems(aiResponse, levels);
      applyFallbackConfidence(items, result.pipelineComplete);

      toast({
        title: "Extraction Complete",
        description: `Found ${totalItems} plan items`,
      });

      const dedupData = result.dedupResults || [];
      setDedupResults(dedupData);

      return { items, levels, personMappings, sessionConfidence };

    } catch (error) {
      console.error('AI pipeline error:', error);
      toast({
        title: "Extraction Failed",
        description: getUserFriendlyError(error, 'extraction'),
        variant: "destructive",
      });
      return null;
    } finally {
      setIsExtracting(false);
    }
  };

  const countAllItems = (list: PlanItem[]): number =>
    list.reduce((sum, item) => sum + 1 + countAllItems(item.children || []), 0);

  const finalizeExtraction = (items: PlanItem[], method: 'text' | 'vision') => {
    const total = countAllItems(items);
    aggregateAndUpdateSession(total, method);
  };

  const evaluateTextQuality = (text: string, pageCount: number): { useText: boolean; charsPerPage: number; reason: string } => {
    const charsPerPage = pageCount > 0 ? text.length / pageCount : 0;
    
    if (charsPerPage < CHARS_PER_PAGE_THRESHOLD) {
      return { useText: false, charsPerPage, reason: `Low text density (${Math.round(charsPerPage)} chars/page)` };
    }

    const alphanumeric = text.replace(/[^a-zA-Z0-9]/g, '').length;
    const ratio = text.length > 0 ? alphanumeric / text.length : 0;
    if (ratio < 0.3) {
      return { useText: false, charsPerPage, reason: `Text appears corrupted (ratio: ${ratio.toFixed(2)})` };
    }

    return { useText: true, charsPerPage, reason: 'Good text quality' };
  };

  const handleFileUpload = async (file: File) => {
    setIsProcessing(true);
    setUploadedFile(file);
    setExtractedItems(null);
    setExtractedMappings(null);
    setDetectedLevels(null);
    setUseVisionAI(false);
    resetProgress();
    setStepProgress('upload', 0);
    addMessage('Starting file analysis...');

    updateSessionRow({ document_name: file.name, document_size_bytes: file.size });

    try {
      const fileName = file.name.toLowerCase();
      const isPdf = fileName.endsWith('.pdf');
      const isWord = fileName.endsWith('.doc') || fileName.endsWith('.docx');
      const isExcel = fileName.endsWith('.xls') || fileName.endsWith('.xlsx');
      
      const textExtensions = ['.txt', '.csv', '.json', '.xml', '.md'];
      const isTextFile = textExtensions.some(ext => fileName.endsWith(ext)) || file.type.startsWith('text/');

      let extractedText = '';

      if (isPdf) {
        const MAX_TEXT_EXTRACTION_SIZE = 8 * 1024 * 1024; // 8MB
        let textResult: { text: string; pageCount: number } | null = null;

        if (file.size > MAX_TEXT_EXTRACTION_SIZE) {
          console.log(`Document exceeds 8MB (${(file.size / 1024 / 1024).toFixed(1)}MB) — using visual analysis`);
          addMessage('Document uploaded successfully');
        } else {
          // Try text extraction first for smaller files
          try {
            textResult = await parsePdfWithEdgeFunction(file);
          } catch (error: any) {
            console.log(`Text extraction failed (${error?.message || error}), falling back to visual analysis`);
            addMessage('Switching to visual analysis...');
          }
        }

        if (textResult) {
          // Check page count limit
          if (textResult.pageCount > MAX_PDF_PAGES) {
            setPageCountError(`This document has ${textResult.pageCount} pages. The current limit is ${MAX_PDF_PAGES} pages. Try uploading only the section that contains your strategic plan, or use Document Scope to narrow the page range.`);
            setFileContent('');
            setIsProcessing(false);
            return;
          }
          const quality = evaluateTextQuality(textResult.text, textResult.pageCount);
          console.log(`Text quality: ${Math.round(quality.charsPerPage)} chars/page, threshold: ${CHARS_PER_PAGE_THRESHOLD}. Decision: ${quality.useText ? 'text' : 'vision'}. ${quality.reason}`);

          if (quality.useText) {
            // Text path
            setFileContent(textResult.text);
            setIsProcessing(false);

            const aiResult = await extractPlanItemsWithAI(textResult.text);
            if (!aiResult || aiResult.items.length === 0) {
              console.log('Text extraction found 0 items, falling back to vision');
              addMessage('Trying visual analysis...');
              const visionResult = await extractWithVisionPipeline(file, undefined, textResult?.text);
              if (visionResult) {
                setExtractedItems(visionResult.items);
                setExtractedMappings(visionResult.personMappings);
                setDetectedLevels(visionResult.levels);
                setFileContent('__VISION_EXTRACTED__');
                finalizeExtraction(visionResult.items, 'vision');
              }
              return;
            }

            setExtractedItems(aiResult.items);
            setExtractedMappings(aiResult.personMappings);
            setDetectedLevels(aiResult.levels);
            finalizeExtraction(aiResult.items, 'text');
            return;
          }
        }

        // Vision path (text quality poor or text extraction failed)
        setIsProcessing(false);
        const visionResult = await extractWithVisionPipeline(file, undefined, textResult?.text);
        if (visionResult) {
          setExtractedItems(visionResult.items);
          setExtractedMappings(visionResult.personMappings);
          setDetectedLevels(visionResult.levels);
          setFileContent('__VISION_EXTRACTED__');
          finalizeExtraction(visionResult.items, 'vision');
        }
        return;
        
      } else if (isExcel || fileName.endsWith('.csv')) {
        // Route to spreadsheet import path
        setIsProcessing(false);
        setSpreadsheetFile(file);
        return;
      } else if (isWord) {
        addMessage('Processing document...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        extractedText = SAMPLE_RAW_TEXT;
        toast({
          title: "Document loaded",
          description: "Using sample data for demo. Full Word support coming soon.",
        });
      } else if (isTextFile) {
        addMessage('Reading file...');
        const reader = new FileReader();
        const content = await new Promise<string>((resolve, reject) => {
          reader.onload = (e) => resolve(e.target?.result as string || '');
          reader.onerror = () => reject(new Error('Failed to read file'));
          reader.readAsText(file);
        });
        extractedText = content && content.length > 0 ? content : SAMPLE_RAW_TEXT;
      } else {
        extractedText = SAMPLE_RAW_TEXT;
        toast({
          title: "Unsupported format",
          description: "Using sample data. Try PDF, TXT, or CSV files.",
          variant: "destructive",
        });
      }

      setFileContent(extractedText);
      setIsProcessing(false);
      
      const textResult = await extractPlanItemsWithAI(extractedText);
      if (textResult) {
        setExtractedItems(textResult.items);
        setExtractedMappings(textResult.personMappings);
        setDetectedLevels(textResult.levels);
        finalizeExtraction(textResult.items, 'text');
      }
      
    } catch (error) {
      console.error('File processing error:', error);
      setFileContent(SAMPLE_RAW_TEXT);
      updateSessionRow({ status: 'failed' });
      toast({
        title: "Processing failed",
        description: getUserFriendlyError(error, 'upload'),
        variant: "destructive",
      });
      setIsProcessing(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const loadSampleData = async () => {
    setUploadedFile({ name: 'sample-strategic-plan.txt', size: SAMPLE_RAW_TEXT.length } as File);
    setFileContent(SAMPLE_RAW_TEXT);
    resetProgress();
    const textResult = await extractPlanItemsWithAI(SAMPLE_RAW_TEXT);
    if (textResult) {
      setExtractedItems(textResult.items);
      setExtractedMappings(textResult.personMappings);
      setDetectedLevels(textResult.levels);
    }
  };

  const handleContinue = () => {
    if (extractedItems && extractedMappings && detectedLevels && onAIExtraction) {
      onAIExtraction(extractedItems, extractedMappings, detectedLevels);
    } else if (hasExistingItems && onAdvanceExisting) {
      onAdvanceExisting();
    } else if (fileContent.trim() && fileContent !== '__VISION_EXTRACTED__') {
      onTextSubmit(fileContent);
    }
  };

  const clearFile = () => {
    setUploadedFile(null);
    setFileContent('');
    setExtractedItems(null);
    setExtractedMappings(null);
    setDetectedLevels(null);
    setProcessingStatus('');
    setUseVisionAI(false);
    setVisionError(null);
    setPageCountError(null);
    setPasteMode(false);
    setPastedText('');
    resetProgress();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handlePasteSubmit = async () => {
    if (!pastedText.trim()) return;
    setVisionError(null);
    setPasteMode(false);
    setFileContent(pastedText);
    const result = await extractPlanItemsWithAI(pastedText);
    if (result) {
      setExtractedItems(result.items);
      setExtractedMappings(result.personMappings);
      setDetectedLevels(result.levels);
      finalizeExtraction(result.items, 'text');
    }
  };

  const isLoading = isProcessing || isExtracting;

  // Spreadsheet import path — render SpreadsheetImportStep instead of main UI
  if (spreadsheetFile && sessionId && onSpreadsheetComplete) {
    return (
      <div className="w-full max-w-4xl mx-auto space-y-6">
        <SpreadsheetImportStep
          file={spreadsheetFile}
          sessionId={sessionId}
          onComplete={onSpreadsheetComplete}
        />
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      <Card className="border-border/50 shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-2xl text-foreground">
            <Upload className="h-6 w-6 text-primary" />
            Upload Your Strategic Plan
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Upload your strategic plan document to get started. We support PDF, Word, Excel, and text files.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!uploadedFile ? (
            <>
              <div
                className={`relative border-2 border-dashed rounded-lg p-12 transition-all cursor-pointer ${
                  isDragging 
                    ? 'border-primary bg-primary/5 scale-[1.01]' 
                    : 'border-border hover:border-primary/50 hover:bg-muted/30'
                }`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.pdf,.doc,.docx,.xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file);
                  }}
                />
                <div className="flex flex-col items-center gap-4 text-center">
                  <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                    <FileText className="h-8 w-8 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold text-lg text-foreground">
                      Drag and drop your file here
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      or click to browse your computer
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-center gap-2 mt-2">
                    {['PDF', 'Word', 'Excel', 'CSV', 'Text'].map((format) => (
                      <span
                        key={format}
                        className="px-3 py-1 text-xs font-medium rounded-full bg-secondary text-secondary-foreground"
                      >
                        {format}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              {/* File status */}
              <div className="flex items-center justify-between p-4 rounded-lg bg-success/10 border border-success/20">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-success/20 flex items-center justify-center">
                    {isProcessing ? (
                      <Loader2 className="h-5 w-5 text-success animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-5 w-5 text-success" />
                    )}
                  </div>
                  <div>
                    <p className="font-medium text-foreground">{uploadedFile.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {isProcessing ? processingStatus || 'Processing...' : 'Document processed'}
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={clearFile} disabled={isLoading}>
                  Remove
                </Button>
              </div>

              {/* Page count error blocker */}
              {pageCountError && (
                <Alert variant="destructive" className="border-destructive/50 bg-destructive/5">
                  <AlertTriangle className="h-5 w-5" />
                  <AlertTitle>Document Too Large</AlertTitle>
                  <AlertDescription>{pageCountError}</AlertDescription>
                </Alert>
              )}

              {/* Processing Overlay */}
              {isLoading && (
                <ProcessingOverlay
                  currentStep={progressState.currentStep}
                  stepProgress={progressState.stepProgress}
                  statusMessages={progressState.messages}
                  orgName={orgProfile?.organizationName}
                  industry={orgProfile?.industry}
                />
              )}

              {/* Vision error with paste fallback */}
              {!isLoading && visionError && !extractedItems && (
                <div className="space-y-4">
                  <div className="p-4 rounded-lg border border-destructive/30 bg-destructive/5">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
                      <div className="space-y-2">
                        <p className="font-medium text-foreground">
                          This document couldn't be processed automatically
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Complex tables and merged cells can be difficult to extract. Try pasting the plan text directly, or re-save the PDF at a lower resolution.
                        </p>
                        {!pasteMode && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPasteMode(true)}
                            className="mt-2"
                          >
                            <ClipboardPaste className="h-4 w-4 mr-2" />
                            Paste Text Instead
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>

                  {pasteMode && (
                    <div className="space-y-3">
                      <Textarea
                        placeholder="Paste your strategic plan text here..."
                        value={pastedText}
                        onChange={(e) => setPastedText(e.target.value)}
                        className="min-h-[200px] text-sm"
                      />
                      <div className="flex gap-2">
                        <Button
                          onClick={handlePasteSubmit}
                          disabled={!pastedText.trim() || isExtracting}
                          className="flex-1"
                        >
                          {isExtracting ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Extracting...
                            </>
                          ) : (
                            'Extract from Pasted Text'
                          )}
                        </Button>
                        <Button variant="ghost" onClick={() => { setPasteMode(false); setPastedText(''); }}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Completed extraction status */}
              {!isLoading && extractedItems && (
                <div className="flex items-center justify-between p-4 rounded-lg border bg-success/10 border-success/20">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-success/20 flex items-center justify-center">
                      <CheckCircle2 className="h-5 w-5 text-success" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">Plan Items Found</p>
                      <p className="text-sm text-muted-foreground">
                        {countAllItems(extractedItems)} items extracted successfully
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Preview of extracted items */}
              {extractedItems && extractedItems.length > 0 && !isLoading && (
                <div className="p-4 rounded-lg bg-muted/50 border border-border space-y-2">
                  <p className="text-sm font-medium text-foreground">Preview of extracted items:</p>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    {extractedItems.slice(0, 5).map((item) => (
                      <li key={item.id} className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground/60">{item.order}</span>
                        <span className="truncate">{item.name}</span>
                      </li>
                    ))}
                    {extractedItems.length > 5 && (
                      <li className="text-xs text-muted-foreground/60">
                        ...and {extractedItems.length - 5} more items
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}

          <Button
            onClick={handleContinue}
            disabled={(!fileContent.trim() && !extractedItems && !hasExistingItems) || isLoading || !!pageCountError}
            className="w-full h-12 text-base font-medium"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : extractedItems ? (
              `Continue with ${extractedItems.length} Items`
            ) : hasExistingItems ? (
              'Continue with Existing Data'
            ) : (
              'Continue to Level Verification'
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
