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
const WEIGHTS_WITH_VISION = { upload: 0.10, analysis: 0.35, verification: 0.10, vision: 0.45 };
const WEIGHTS_NO_VISION = { upload: 0.10, analysis: 0.80, verification: 0.10, vision: 0 };

function calcOverallProgress(
  phase: ProcessingPhase,
  phaseProgress: number,
  isVisionNeeded: boolean
): number {
  const weights = isVisionNeeded ? WEIGHTS_WITH_VISION : WEIGHTS_NO_VISION;
  const order: ProcessingPhase[] = ['upload', 'analysis', 'verification', 'vision'];
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

export function FileUploadStep({ onTextSubmit, onAIExtraction, orgProfile, sessionId }: FileUploadStepProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const [extractedItems, setExtractedItems] = useState<PlanItem[] | null>(null);
  const [extractedMappings, setExtractedMappings] = useState<PersonMapping[] | null>(null);
  const [detectedLevels, setDetectedLevels] = useState<PlanLevel[] | null>(null);
  const [useVisionAI, setUseVisionAI] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Structured progress state
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
      
      console.log('[FileUpload] Found', logs?.length ?? 0, 'api_call_log rows for session:', sessionId);
      
      const totals = (logs || []).reduce(
        (acc, row) => ({
          total_api_calls: acc.total_api_calls + 1,
          total_input_tokens: acc.total_input_tokens + (row.input_tokens || 0),
          total_output_tokens: acc.total_output_tokens + (row.output_tokens || 0),
          total_duration_ms: acc.total_duration_ms + (row.duration_ms || 0),
        }),
        { total_api_calls: 0, total_input_tokens: 0, total_output_tokens: 0, total_duration_ms: 0 }
      );

      console.log('[FileUpload] Aggregated totals:', totals);

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

    console.log('[FileUpload] Calling parse-pdf with sessionId:', sessionId);
    // Update session with document info
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

  // Verification: checks extraction quality
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

  const extractWithVisionAI = async (
    file: File,
    levelHints?: PlanLevel[]
  ): Promise<{ items: PlanItem[]; levels: PlanLevel[]; personMappings: PersonMapping[] } | null> => {
    setIsExtracting(true);
    setUseVisionAI(true);
    setPhaseProgress('vision', 0, true);
    addMessage('Rendering PDF pages for visual analysis...');

    try {
      const { images, pageCount } = await renderPDFToImages(file, 20, 1.0);
      setProgressState(prev => ({ ...prev, pageCount }));
      addMessage(`Rendered ${images.length} of ${pageCount} pages`);
      setPhaseProgress('vision', 10, true);

      const batches = batchPageImages(images, 5);
      
      let allItems: AIExtractionResponse['items'] = [];
      let detectedLevelsFromVision: AIExtractionResponse['detectedLevels'] = [];
      let previousContext = '';

      if (levelHints && levelHints.length > 0) {
        const levelNames = levelHints.map(l => l.name).join(', ');
        previousContext = `Document hierarchy terminology detected from text analysis: ${levelNames}. Use these SAME level terms for consistency.`;
      }

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        const startPage = batchIndex * 5 + 1;
        const endPage = startPage + batch.length - 1;
        
        const batchPct = 10 + ((batchIndex + 1) / batches.length) * 85;
        setPhaseProgress('vision', batchPct, true);
        addMessage(`Vision AI analyzing pages ${startPage}-${endPage}...`);

        if (batchIndex > 0) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        }

        let result: any = null;
        let retries = 0;
        const maxRetries = 3;

        while (retries <= maxRetries) {
          const response = await fetch(`${SUPABASE_URL}/functions/v1/extract-plan-vision`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              pageImages: batch.map(img => img.dataUrl),
              previousContext,
              organizationName: orgProfile?.organizationName,
              industry: orgProfile?.industry,
              documentHints: orgProfile?.documentHints,
              sessionId,
            }),
          });

          if (response.status === 429 && retries < maxRetries) {
            retries++;
            const waitTime = Math.pow(2, retries) * 2000;
            addMessage(`Rate limited — retrying in ${waitTime / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }

          if (!response.ok) {
            const error = await response.json();
            if (response.status === 429) {
              throw new Error('AI rate limit reached. Please wait a moment and try again.');
            }
            if (response.status === 402) {
              throw new Error('AI credits exhausted. Please add credits to continue.');
            }
            throw new Error(error.error || 'Vision AI extraction failed');
          }

          result = await response.json();
          break;
        }

        if (!result?.success || !result?.data) {
          throw new Error(result?.error || 'Vision AI returned no data');
        }

        if (result.data.items?.length > 0) {
          allItems = mergeVisionResults(allItems, result.data.items);
        }
        
        if (batchIndex === 0 && result.data.documentTerminology?.columnHierarchy?.length > 0) {
          detectedLevelsFromVision = result.data.documentTerminology.columnHierarchy.map(
            (name: string, idx: number) => ({ depth: idx + 1, name })
          );
        } else if (result.data.detectedLevels?.length > 0 && detectedLevelsFromVision.length === 0) {
          detectedLevelsFromVision = result.data.detectedLevels;
        }

        if (result.contextSummary) {
          previousContext = result.contextSummary;
        }
      }

      setPhaseProgress('vision', 100, true);

      const aiResponse: AIExtractionResponse = {
        items: allItems,
        detectedLevels: detectedLevelsFromVision.length > 0 ? detectedLevelsFromVision : [
          { depth: 1, name: 'Strategic Priority' },
          { depth: 2, name: 'Objective' },
          { depth: 3, name: 'Goal' },
          { depth: 4, name: 'Strategy' },
          { depth: 5, name: 'KPI' },
        ],
      };

      const levels: PlanLevel[] = aiResponse.detectedLevels.map((l, idx) => ({
        id: String(idx + 1),
        name: cleanLevelName(l.name),
        depth: l.depth,
      }));

      const { items, personMappings } = convertAIResponseToPlanItems(aiResponse, levels);

      const itemCount = items.length;
      addMessage(`Vision AI found ${itemCount} trackable plan items`);
      
      toast({
        title: "Vision AI Analysis Complete",
        description: `Extracted ${itemCount} plan items from visual document analysis`,
      });

      return { items, levels, personMappings };

    } catch (error) {
      console.error('Vision AI extraction error:', error);
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

  const mergeVisionResults = (
    existing: AIExtractionResponse['items'],
    newItems: AIExtractionResponse['items']
  ): AIExtractionResponse['items'] => {
    if (existing.length === 0) return newItems;
    
    const existingNames = new Set(existing.map(item => item.name.toLowerCase()));
    
    const uniqueNewItems = newItems.filter(item => {
      if (!item?.name) return false;
      const nameLower = item.name.toLowerCase();
      if (existingNames.has(nameLower)) return false;
      existingNames.add(nameLower);
      return true;
    });

    return [...existing, ...uniqueNewItems];
  };

  const extractPlanItemsWithAI = async (text: string): Promise<{ items: PlanItem[]; levels: PlanLevel[]; personMappings: PersonMapping[] } | null> => {
    setIsExtracting(true);
    const chunkCount = Math.ceil(text.length / 25000);
    setPhaseProgress('analysis', 0);
    addMessage(chunkCount > 1 ? `AI analyzing document (${chunkCount} chunks)...` : 'AI analyzing document for plan items...');

    try {
      console.log('[FileUpload] Calling extract-plan-items with sessionId:', sessionId);
      const response = await fetch(`${SUPABASE_URL}/functions/v1/extract-plan-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          documentText: text,
          organizationName: orgProfile?.organizationName,
          industry: orgProfile?.industry,
          documentHints: orgProfile?.documentHints,
          sessionId,
        }),
      });

      setPhaseProgress('analysis', 80);

      if (!response.ok) {
        const error = await response.json();
        if (response.status === 429) throw new Error('AI rate limit reached. Please wait a moment and try again.');
        if (response.status === 402) throw new Error('AI credits exhausted. Please add credits to continue.');
        throw new Error(error.error || 'AI extraction failed');
      }

      const result = await response.json();

      if (!result.success || !result.data) {
        throw new Error(result.error || 'AI extraction returned no data');
      }

      setPhaseProgress('analysis', 100);

      const aiResponse: AIExtractionResponse = result.data;
      
      const totalItems = result.totalItems || 0;
      const bulletMarkers = result.bulletMarkersDetected || 0;
      const chunksProcessed = result.chunksProcessed || 1;
      console.log(`Extraction complete: ${totalItems} items, ${bulletMarkers} bullet markers, ${chunksProcessed} chunks`);
      addMessage(`Found ${totalItems} total items across ${chunksProcessed} chunk(s)`);
      
      const levels: PlanLevel[] = aiResponse.detectedLevels?.length > 0
        ? aiResponse.detectedLevels.map((l, idx) => ({
            id: String(idx + 1),
            name: cleanLevelName(l.name),
            depth: l.depth,
          }))
        : DEFAULT_LEVELS;

      const { items, personMappings } = convertAIResponseToPlanItems(aiResponse, levels);

      const itemCount = items.length;
      addMessage(`${itemCount} top-level items structured`);
      
      toast({
        title: "AI Analysis Complete",
        description: `Extracted ${totalItems} plan items from your document${chunksProcessed > 1 ? ` (${chunksProcessed} chunks)` : ''}`,
      });

      return { items, levels, personMappings };

    } catch (error) {
      console.error('AI extraction error:', error);
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

  // Helper: count all items recursively
  const countAllItems = (list: PlanItem[]): number =>
    list.reduce((sum, item) => sum + 1 + countAllItems(item.children || []), 0);

  // Helper: finalize extraction result and update session
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

    // Update session with document info for non-PDF paths too
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
          const visionResult = await extractWithVisionAI(file);
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
          const visionResult = await extractWithVisionAI(file);
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
          const visionResult = await extractWithVisionAI(file);
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
          const visionResult = await extractWithVisionAI(file);
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

        // AI text analysis
        const textResult = await extractPlanItemsWithAI(extractedText);

        if (!textResult || textResult.items.length === 0) {
          console.log('Text AI found 0 items, falling back to Vision AI with level hints');
          addMessage('Text analysis found no items, trying visual analysis...');
          const levelHints = textResult?.levels || undefined;
          const visionResult = await extractWithVisionAI(file, levelHints);
          if (visionResult) {
            setExtractedItems(visionResult.items);
            setExtractedMappings(visionResult.personMappings);
            setDetectedLevels(visionResult.levels);
            setFileContent('__VISION_EXTRACTED__');
            finalizeExtraction(visionResult.items, 'vision');
          }
          return;
        }

        // Verification
        setPhaseProgress('verification', 0);
        addMessage('Verifying extraction quality...');
        const verification = verifyExtractionResult(textResult.items, textResult.levels, pageCount, extractedText.length);
        setPhaseProgress('verification', 100);
        
        if (!verification.passed) {
          console.log(`Text extraction verification failed: ${verification.reason}. Trying Vision AI...`);
          addMessage(`Verification: ${verification.reason}. Trying visual analysis...`);
          const visionResult = await extractWithVisionAI(file, textResult.levels);
          if (visionResult) {
            const visionVerification = verifyExtractionResult(visionResult.items, visionResult.levels, pageCount);
            if (visionVerification.passed) {
              setExtractedItems(visionResult.items);
              setExtractedMappings(visionResult.personMappings);
              setDetectedLevels(visionResult.levels);
              setFileContent('__VISION_EXTRACTED__');
              finalizeExtraction(visionResult.items, 'vision');
              return;
            } else {
              console.log(`Vision verification also failed: ${visionVerification.reason}. Using best result.`);
              const textTotal = countAllItems(textResult.items);
              const visionTotal = countAllItems(visionResult.items);
              
              if (visionTotal > textTotal) {
                setExtractedItems(visionResult.items);
                setExtractedMappings(visionResult.personMappings);
                setDetectedLevels(visionResult.levels);
                setFileContent('__VISION_EXTRACTED__');
                finalizeExtraction(visionResult.items, 'vision');
              } else {
                setExtractedItems(textResult.items);
                setExtractedMappings(textResult.personMappings);
                setDetectedLevels(textResult.levels);
                finalizeExtraction(textResult.items, 'text');
              }
              toast({
                title: "Extraction may be incomplete",
                description: "We extracted what we could, but some items may be missing. Please review carefully.",
                variant: "destructive",
              });
              return;
            }
          }
          setExtractedItems(textResult.items);
          setExtractedMappings(textResult.personMappings);
          setDetectedLevels(textResult.levels);
          finalizeExtraction(textResult.items, 'text');
          toast({
            title: "Extraction may be incomplete",
            description: verification.reason + ". Please review carefully.",
            variant: "destructive",
          });
          return;
        }

        addMessage('Verification passed — extraction complete');
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
