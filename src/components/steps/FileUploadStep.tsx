import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Upload, FileText, CheckCircle2, Loader2 } from 'lucide-react';
import { SAMPLE_RAW_TEXT, PlanItem, PersonMapping, PlanLevel, DEFAULT_LEVELS } from '@/types/plan';
import { toast } from '@/hooks/use-toast';
import { getUserFriendlyError } from '@/utils/getUserFriendlyError';
import { AIExtractionResponse, convertAIResponseToPlanItems } from '@/utils/textParser';
import { cleanLevelName } from '@/utils/cleanLevelName';
import { renderPDFToImages } from '@/utils/pdfToImages';
import { ProcessingOverlay, ProcessingStep } from './ProcessingOverlay';
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

  const extractWithVisionPipeline = async (
    file: File,
    _levelHints?: PlanLevel[]
  ): Promise<{ items: PlanItem[]; levels: PlanLevel[]; personMappings: PersonMapping[]; sessionConfidence?: number } | null> => {
    setIsExtracting(true);
    setUseVisionAI(true);
    setStepProgress('extract', 0);
    addMessage('Extracting plan items...');

    try {
      const pageRange = orgProfile?.pageRange;
      const { images, pageCount } = await renderPDFToImages(file, 20, 1.0, pageRange);
      setStepProgress('extract', 20);

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

      setStepProgress('extract', 60);

      if (!response.ok) {
        const error = await response.json();
        if (response.status === 429) throw new Error('AI rate limit reached. Please wait a moment and try again.');
        if (response.status === 402) throw new Error('AI credits exhausted. Please add credits to continue.');
        throw new Error(error.error || 'Extraction failed');
      }

      const result = await response.json();

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Extraction returned no data');
      }

      setStepProgress('extract', 100);
      addMessage(`Extraction complete — found ${result.totalItems || 0} items`);

      setStepProgress('audit', 50);
      addMessage('Reviewing for completeness...');
      setStepProgress('audit', 100);
      addMessage('Audit complete');

      setStepProgress('validate', 50);
      addMessage('Validating structure...');
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

      return { items, levels, personMappings, sessionConfidence };

    } catch (error) {
      console.error('Vision pipeline error:', error);
      toast({
        title: "Extraction Failed",
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

      setStepProgress('extract', 50);

      if (!response.ok) {
        const error = await response.json();
        if (response.status === 429) throw new Error('AI rate limit reached. Please wait a moment and try again.');
        if (response.status === 402) throw new Error('AI credits exhausted. Please add credits to continue.');
        throw new Error(error.error || 'Extraction failed');
      }

      const result = await response.json();

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Extraction returned no data');
      }

      setStepProgress('extract', 100);
      addMessage(`Extraction complete — found ${result.totalItems || 0} items`);

      setStepProgress('audit', 50);
      addMessage('Reviewing for completeness...');
      setStepProgress('audit', 100);
      addMessage('Audit complete');

      setStepProgress('validate', 50);
      addMessage('Validating structure...');
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

            setExtractedItems(aiResult.items);
            setExtractedMappings(aiResult.personMappings);
            setDetectedLevels(aiResult.levels);
            finalizeExtraction(aiResult.items, 'text');
            return;
          }
        }

        // Vision path (text quality poor or text extraction failed)
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
                      {isProcessing ? processingStatus || 'Processing...' : 'Document processed'}
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={clearFile} disabled={isLoading}>
                  Remove
                </Button>
              </div>

              {/* Processing Overlay */}
              {isLoading && (
                <ProcessingOverlay
                  currentStep={progressState.currentStep}
                  stepProgress={progressState.stepProgress}
                  statusMessages={progressState.messages}
                  orgName={orgProfile?.organizationName}
                />
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
            disabled={(!fileContent.trim() && !extractedItems) || isLoading}
            className="w-full h-12 text-base font-medium"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : extractedItems ? (
              `Continue with ${extractedItems.length} Items`
            ) : (
              'Continue to Level Verification'
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
