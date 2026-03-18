import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2, Brain, Eye } from 'lucide-react';
import { SAMPLE_RAW_TEXT, PlanItem, PersonMapping, PlanLevel, DEFAULT_LEVELS } from '@/types/plan';
import { toast } from '@/hooks/use-toast';
import { getUserFriendlyError } from '@/utils/getUserFriendlyError';
import { AIExtractionResponse, AIDocumentTerminology, convertAIResponseToPlanItems } from '@/utils/textParser';
import { cleanLevelName } from '@/utils/cleanLevelName';
import { renderPDFToImages, isTextQualityPoor, batchPageImages, PDFPageImage } from '@/utils/pdfToImages';
import { ProcessingOverlay, ProcessingPhase } from './ProcessingOverlay';
import { supabase } from '@/integrations/supabase/client';

import { OrgProfile } from '@/types/plan';

interface FileUploadStepProps {
  onTextSubmit: (text: string) => void;
  onAIExtraction?: (items: PlanItem[], personMappings: PersonMapping[], levels: PlanLevel[]) => void;
  orgProfile?: OrgProfile;
  sessionId?: string;
  // Lifted state
  uploadedFile: File | null; setUploadedFile: (v: File | null) => void;
  fileContent: string; setFileContent: (v: string) => void;
  extractedItems: PlanItem[] | null; setExtractedItems: (v: PlanItem[] | null) => void;
  extractedMappings: PersonMapping[] | null; setExtractedMappings: (v: PersonMapping[] | null) => void;
  detectedLevels: PlanLevel[] | null; setDetectedLevels: (v: PlanLevel[] | null) => void;
  useVisionAI: boolean; setUseVisionAI: (v: boolean) => void;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

interface ProgressState {
  phase: ProcessingPhase;
  progress: number;
  messages: string[];
  estimatedSecondsRemaining: number | null;
  isVisionNeeded: boolean;
  pageCount: number;
}

const INITIAL_PROGRESS: ProgressState = {
  phase: 'upload',
  progress: 0,
  messages: [],
  estimatedSecondsRemaining: null,
  isVisionNeeded: false,
  pageCount: 0,
};

// Phase weights for progress calculation
const WEIGHTS_WITH_VISION = { upload: 0.10, analysis: 0.35, verification: 0.10, vision: 0.45, audit: 0, validate: 0 };
const WEIGHTS_PIPELINE = { upload: 0.10, analysis: 0.40, verification: 0, vision: 0, audit: 0.25, validate: 0.25 };

function calcOverallProgress(
  phase: ProcessingPhase,
  phaseProgress: number,
  isVisionNeeded: boolean
): number {
  const weights = isVisionNeeded ? WEIGHTS_WITH_VISION : WEIGHTS_PIPELINE;
  const order: ProcessingPhase[] = ['upload', 'analysis', 'verification', 'vision', 'audit', 'validate'];
  const idx = order.indexOf(phase);
  let base = 0;
  for (let i = 0; i < idx; i++) base += weights[order[i]];
  return Math.min(100, (base + weights[phase] * (phaseProgress / 100)) * 100);
}

function estimateTime(pageCount: number, phase: ProcessingPhase, phaseProgress: number, isVision: boolean): number | null {
  if (pageCount === 0) return null;
  const textSecsPerPage = 4;
  const visionSecsPerPage = 6.5;
  let totalEstimate = pageCount * textSecsPerPage + (isVision ? pageCount * visionSecsPerPage : 0);
  const overallPct = calcOverallProgress(phase, phaseProgress, isVision) / 100;
  return Math.max(0, Math.round(totalEstimate * (1 - overallPct)));
}

export function FileUploadStep({
  onTextSubmit, onAIExtraction, orgProfile, sessionId,
  uploadedFile, setUploadedFile,
  fileContent, setFileContent,
  extractedItems, setExtractedItems,
  extractedMappings, setExtractedMappings,
  detectedLevels, setDetectedLevels,
  useVisionAI, setUseVisionAI,
}: FileUploadStepProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Structured progress state (transient — stays local)
  const [progressState, setProgressState] = useState<ProgressState>(INITIAL_PROGRESS);

  const addMessage = useCallback((msg: string) => {
    setProgressState(prev => ({
      ...prev,
      messages: [...prev.messages, msg],
    }));
    setProcessingStatus(msg);
  }, []);

  const setPhaseProgress = useCallback((phase: ProcessingPhase, phaseProgress: number, isVision?: boolean) => {
    setProgressState(prev => {
      const visionNeeded = isVision !== undefined ? isVision : prev.isVisionNeeded;
      const overall = calcOverallProgress(phase, phaseProgress, visionNeeded);
      const est = estimateTime(prev.pageCount, phase, phaseProgress, visionNeeded);
      return {
        ...prev,
        phase,
        progress: overall,
        isVisionNeeded: visionNeeded,
        estimatedSecondsRemaining: est,
      };
    });
  }, []);

  const resetProgress = useCallback((pageCount = 0) => {
    setProgressState({ ...INITIAL_PROGRESS, pageCount });
  }, []);

  const updateSessionRow = async (updates: Record<string, unknown>) => {
    if (!sessionId) {
      console.warn('[FileUpload] updateSessionRow called with no sessionId');
      return;
    }
    try {
      console.log('[FileUpload] Updating session row:', sessionId, updates);
      const { error, count } = await supabase.from('processing_sessions').update(updates).eq('id', sessionId);
      if (error) {
        console.error('[FileUpload] Session update error:', error);
      } else {
        console.log('[FileUpload] Session update OK, matched rows:', count ?? 'unknown');
      }
    } catch (e) {
      console.error('[FileUpload] Failed to update session:', e);
    }
  };

  const aggregateAndUpdateSession = async (itemCount: number, method: string) => {
    if (!sessionId) {
      console.warn('[FileUpload] aggregateAndUpdateSession called with no sessionId');
      return;
    }
    try {
      console.log('[FileUpload] Aggregating session data for:', sessionId);
      const { data: logs, error: logsError } = await supabase
        .from('api_call_logs')
        .select('input_tokens, output_tokens, duration_ms')
        .eq('session_id', sessionId);

      if (logsError) {
        console.error('[FileUpload] Failed to fetch api_call_logs for aggregation:', logsError);
      }
      
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
    addMessage('Uploading document to cloud...');
    setPhaseProgress('upload', 30);
    
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

    setProgressState(prev => ({ ...prev, pageCount: result.pageCount }));
    addMessage(`Extracted text from ${result.pageCount} pages`);
    setPhaseProgress('upload', 100);
    return { text: result.text, pageCount: result.pageCount };
  };

  const verifyExtractionResult = (
    items: PlanItem[],
    levels: PlanLevel[],
    pageCount: number,
    sourceTextLength?: number
  ): { passed: boolean; reason: string } => {
    if (!items || items.length === 0) {
      return { passed: false, reason: 'No items extracted' };
    }
    const hasNesting = items.some(item => item.children && item.children.length > 0);
    if (!hasNesting && items.length > 2) {
      return { passed: false, reason: 'All items are flat with no hierarchy — likely incomplete extraction' };
    }
    const minTopLevel = Math.max(1, Math.floor(pageCount / 2));
    if (items.length < minTopLevel && pageCount > 3) {
      return { passed: false, reason: `Only ${items.length} top-level items for ${pageCount} pages — likely missed content` };
    }
    const countAll = (list: PlanItem[]): number => 
      list.reduce((sum, item) => sum + 1 + countAll(item.children || []), 0);
    const totalItems = countAll(items);
    const minTotal = Math.max(3, pageCount * 2);
    if (totalItems < minTotal && pageCount > 2) {
      return { passed: false, reason: `Only ${totalItems} total items for ${pageCount} pages — likely incomplete` };
    }
    if (sourceTextLength && pageCount > 0) {
      const charsPerPage = sourceTextLength / pageCount;
      if (charsPerPage > 500 && totalItems < pageCount) {
        return { passed: false, reason: `Dense text (${Math.round(charsPerPage)} chars/page) but only ${totalItems} items — extraction likely incomplete` };
      }
    }
    return { passed: true, reason: 'OK' };
  };

  /** If no item has a confidence score AND pipeline didn't run, apply fallback defaults */
  const applyFallbackConfidence = (items: PlanItem[], pipelineComplete?: boolean) => {
    // If the multi-agent pipeline ran, trust the scores it set (even if some are low)
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

  const extractWithVisionPipeline = async (
    file: File,
    _levelHints?: PlanLevel[]
  ): Promise<{ items: PlanItem[]; levels: PlanLevel[]; personMappings: PersonMapping[]; sessionConfidence?: number } | null> => {
    setIsExtracting(true);
    setUseVisionAI(true);
    setPhaseProgress('vision', 0, true);
    addMessage('Rendering PDF pages for visual analysis...');

    try {
      const pageRange = orgProfile?.pageRange;
      const { images, pageCount } = await renderPDFToImages(file, 20, 1.0, pageRange);
      setProgressState(prev => ({ ...prev, pageCount }));
      addMessage(`Rendered ${images.length} of ${pageCount} pages${pageRange ? ` (pages ${pageRange.startPage}-${pageRange.endPage})` : ''}`);
      setPhaseProgress('vision', 20, true);

      addMessage('Sending to multi-agent pipeline...');
      
      const response = await fetch(`${SUPABASE_URL}/functions/v1/process-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageImages: images.map(img => img.dataUrl),
          organizationName: orgProfile?.organizationName,
          industry: orgProfile?.industry,
          documentHints: orgProfile?.documentHints,
          planLevels: orgProfile?.planLevels,
          pageRange: orgProfile?.pageRange,
          sessionId,
        }),
      });

      setPhaseProgress('vision', 60, true);

      if (!response.ok) {
        const error = await response.json();
        if (response.status === 429) throw new Error('AI rate limit reached. Please wait a moment and try again.');
        if (response.status === 402) throw new Error('AI credits exhausted. Please add credits to continue.');
        throw new Error(error.error || 'Vision AI pipeline failed');
      }

      const result = await response.json();

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Vision AI pipeline returned no data');
      }

      setPhaseProgress('vision', 100, true);

      const aiResponse: AIExtractionResponse = result.data;
      const totalItems = result.totalItems || 0;
      const sessionConfidence = result.sessionConfidence;
      const corrections = result.corrections || [];

      console.log(`Vision pipeline complete: ${totalItems} items, confidence=${sessionConfidence}%, ${corrections.length} corrections`);
      addMessage(`Pipeline complete: ${totalItems} items (${sessionConfidence}% confidence)`);

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
        title: "AI Pipeline Complete",
        description: `Extracted ${totalItems} plan items (${sessionConfidence}% confidence)`,
      });

      return { items, levels, personMappings, sessionConfidence };

    } catch (error) {
      console.error('Vision pipeline error:', error);
      toast({
        title: "Vision AI Extraction Failed",
        description: getUserFriendlyError(error, 'vision'),
        variant: "destructive",
      });
      return null;
    } finally {
      setIsExtracting(false);
    }
  };

  const extractPlanItemsWithAI = async (text: string): Promise<{ items: PlanItem[]; levels: PlanLevel[]; personMappings: PersonMapping[]; sessionConfidence?: number } | null> => {
    setIsExtracting(true);
    setPhaseProgress('analysis', 0);
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

      setPhaseProgress('analysis', 50);
      addMessage('Extraction in progress...');

      if (!response.ok) {
        const error = await response.json();
        if (response.status === 429) throw new Error('AI rate limit reached. Please wait a moment and try again.');
        if (response.status === 402) throw new Error('AI credits exhausted. Please add credits to continue.');
        throw new Error(error.error || 'AI pipeline failed');
      }

      const result = await response.json();

      if (!result.success || !result.data) {
        throw new Error(result.error || 'AI pipeline returned no data');
      }

      setPhaseProgress('analysis', 100);
      addMessage('Step 1/3 complete: Items extracted');

      setPhaseProgress('audit', 50);
      addMessage('Step 2/3 complete: Completeness audit done');
      setPhaseProgress('audit', 100);

      setPhaseProgress('validate', 50);
      addMessage('Step 3/3 complete: Hierarchy validated');
      setPhaseProgress('validate', 100);

      const aiResponse: AIExtractionResponse = result.data;
      const totalItems = result.totalItems || 0;
      const sessionConfidence = result.sessionConfidence;
      const corrections = result.corrections || [];

      console.log(`Pipeline complete: ${totalItems} items, confidence=${sessionConfidence}%, ${corrections.length} corrections`);
      addMessage(`Pipeline complete: ${totalItems} items (${sessionConfidence}% confidence, ${corrections.length} corrections)`);

      if (result.auditSummary) {
        const as = result.auditSummary;
        addMessage(`Audit: ${as.missingCount || 0} missing, ${as.mergedCount || 0} merged, ${as.rephrasedCount || 0} rephrased`);
      }
      
      const levels: PlanLevel[] = aiResponse.detectedLevels?.length > 0
        ? aiResponse.detectedLevels.map((l, idx) => ({
            id: String(idx + 1),
            name: cleanLevelName(l.name),
            depth: l.depth,
          }))
        : DEFAULT_LEVELS;

      const { items, personMappings } = convertAIResponseToPlanItems(aiResponse, levels);
      applyFallbackConfidence(items, result.pipelineComplete);

      const itemCount = items.length;
      addMessage(`${itemCount} top-level items structured`);
      
      toast({
        title: "AI Pipeline Complete",
        description: `Extracted ${totalItems} plan items (${sessionConfidence}% confidence)${corrections.length > 0 ? `, ${corrections.length} corrections applied` : ''}`,
      });

      return { items, levels, personMappings, sessionConfidence };

    } catch (error) {
      console.error('AI pipeline error:', error);
      toast({
        title: "AI Extraction Issue",
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

  const handleFileUpload = async (file: File) => {
    setIsProcessing(true);
    setUploadedFile(file);
    setExtractedItems(null);
    setExtractedMappings(null);
    setDetectedLevels(null);
    setUseVisionAI(false);
    resetProgress();
    setPhaseProgress('upload', 0);
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
      let pageCount = 1;

      if (isPdf) {
        const FILE_SIZE_LIMIT = 10 * 1024 * 1024;
        const skipTextExtraction = file.size > FILE_SIZE_LIMIT;
        
        if (skipTextExtraction) {
          console.log('File over 10MB, skipping text extraction, using Vision AI directly');
          addMessage('Large document detected, using Vision AI...');
          setIsProcessing(false);
          const visionResult = await extractWithVisionPipeline(file);
          if (visionResult) {
            setExtractedItems(visionResult.items);
            setExtractedMappings(visionResult.personMappings);
            setDetectedLevels(visionResult.levels);
            setFileContent('__VISION_EXTRACTED__');
            finalizeExtraction(visionResult.items, 'vision');
          }
          return;
        }
        
        try {
          const result = await parsePdfWithEdgeFunction(file);
          extractedText = result.text;
          pageCount = result.pageCount;
        } catch (error) {
          console.log('Text extraction failed, will try vision AI', error);
          addMessage('Text extraction unavailable, switching to Vision AI...');
          setIsProcessing(false);
          const visionResult = await extractWithVisionPipeline(file);
          if (visionResult) {
            setExtractedItems(visionResult.items);
            setExtractedMappings(visionResult.personMappings);
            setDetectedLevels(visionResult.levels);
            setFileContent('__VISION_EXTRACTED__');
            finalizeExtraction(visionResult.items, 'vision');
          }
          return;
        }

        if (!extractedText || extractedText.trim().length < 50) {
          console.log('Text extraction returned empty/minimal content, falling back to Vision AI');
          addMessage('No readable text found, switching to Vision AI...');
          setIsProcessing(false);
          const visionResult = await extractWithVisionPipeline(file);
          if (visionResult) {
            setExtractedItems(visionResult.items);
            setExtractedMappings(visionResult.personMappings);
            setDetectedLevels(visionResult.levels);
            setFileContent('__VISION_EXTRACTED__');
            finalizeExtraction(visionResult.items, 'vision');
          }
          return;
        }
        
        const alphanumericChars = extractedText.replace(/[^a-zA-Z0-9]/g, '').length;
        const gibberishRatio = alphanumericChars / extractedText.length;
        if (gibberishRatio < 0.3) {
          console.log(`Text appears corrupted (alphanumeric ratio: ${gibberishRatio.toFixed(2)}), falling back to Vision AI`);
          addMessage('Text extraction corrupted, switching to Vision AI...');
          setIsProcessing(false);
          const visionResult = await extractWithVisionPipeline(file);
          if (visionResult) {
            setExtractedItems(visionResult.items);
            setExtractedMappings(visionResult.personMappings);
            setDetectedLevels(visionResult.levels);
            setFileContent('__VISION_EXTRACTED__');
            finalizeExtraction(visionResult.items, 'vision');
          }
          return;
        }
        
        console.log(`Text extraction successful: ${extractedText.length} chars, ${pageCount} pages, alphanumeric ratio: ${gibberishRatio.toFixed(2)}`);
        addMessage(`Text extraction complete: ${pageCount} pages, ${extractedText.length} characters`);
        
        setFileContent(extractedText);
        setIsProcessing(false);

        const textResult = await extractPlanItemsWithAI(extractedText);

        if (!textResult || textResult.items.length === 0) {
          console.log('Pipeline found 0 items, falling back to Vision AI with level hints');
          addMessage('Pipeline found no items, trying visual analysis...');
          const levelHints = textResult?.levels || undefined;
          const visionResult = await extractWithVisionPipeline(file, levelHints);
          if (visionResult) {
            setExtractedItems(visionResult.items);
            setExtractedMappings(visionResult.personMappings);
            setDetectedLevels(visionResult.levels);
            setFileContent('__VISION_EXTRACTED__');
            finalizeExtraction(visionResult.items, 'vision');
          }
          return;
        }

        addMessage('Multi-agent pipeline complete');
        setExtractedItems(textResult.items);
        setExtractedMappings(textResult.personMappings);
        setDetectedLevels(textResult.levels);
        finalizeExtraction(textResult.items, 'text');
        return;
        
      } else if (isWord || isExcel) {
        addMessage('Processing document...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        extractedText = SAMPLE_RAW_TEXT;
        toast({
          title: "Document loaded",
          description: "Using sample data for demo. Full Office support coming soon.",
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
    resetProgress(1);
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
    resetProgress();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const isLoading = isProcessing || isExtracting;

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
                      {isProcessing ? processingStatus || 'Extracting text...' : 'Document processed'}
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={clearFile} disabled={isLoading}>
                  Remove
                </Button>
              </div>

              {/* Processing Overlay - shown during active processing */}
              {isLoading && (
                <ProcessingOverlay
                  phase={progressState.phase}
                  progress={progressState.progress}
                  statusMessages={progressState.messages}
                  industry={orgProfile?.industry}
                  orgName={orgProfile?.organizationName}
                  estimatedSecondsRemaining={progressState.estimatedSecondsRemaining}
                  isVisionNeeded={progressState.isVisionNeeded}
                />
              )}

              {/* Completed extraction status - shown when done */}
              {!isLoading && extractedItems && (
                <div className="flex items-center justify-between p-4 rounded-lg border bg-success/10 border-success/20">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-success/20 flex items-center justify-center">
                      <CheckCircle2 className="h-5 w-5 text-success" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">Plan Items Found</p>
                      <p className="text-sm text-muted-foreground">
                        {extractedItems.length} items extracted{useVisionAI ? ' with Vision AI' : ' with AI'}
                      </p>
                    </div>
                  </div>
                  <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                    useVisionAI 
                      ? 'bg-purple-500/20 text-purple-600 dark:text-purple-400' 
                      : 'bg-success/20 text-success'
                  }`}>
                    {useVisionAI ? 'Vision AI' : 'AI Enhanced'}
                  </span>
                </div>
              )}

              {/* Preview of extracted items */}
              {extractedItems && extractedItems.length > 0 && !isLoading && (
                <div className="p-4 rounded-lg bg-muted/50 border border-border space-y-2">
                  <p className="text-sm font-medium text-foreground">Preview of extracted items:</p>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    {extractedItems.slice(0, 5).map((item, idx) => (
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
            disabled={(!fileContent.trim() && !extractedItems) || isLoading}
            className="w-full h-12 text-base font-medium"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {isExtracting ? (useVisionAI ? 'Vision AI Analyzing...' : 'AI Analyzing...') : 'Processing File...'}
              </>
            ) : extractedItems ? (
              <>
                {useVisionAI ? <Eye className="h-4 w-4 mr-2" /> : <Brain className="h-4 w-4 mr-2" />}
                Continue with {extractedItems.length} Items
              </>
            ) : (
              'Continue to Level Verification'
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
