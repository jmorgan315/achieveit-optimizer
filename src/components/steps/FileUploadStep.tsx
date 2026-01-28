import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2, Brain } from 'lucide-react';
import { SAMPLE_RAW_TEXT, PlanItem, PersonMapping, PlanLevel, DEFAULT_LEVELS } from '@/types/plan';
import { toast } from '@/hooks/use-toast';
import { AIExtractionResponse, convertAIResponseToPlanItems } from '@/utils/textParser';

interface FileUploadStepProps {
  onTextSubmit: (text: string) => void;
  onAIExtraction?: (items: PlanItem[], personMappings: PersonMapping[], levels: PlanLevel[]) => void;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export function FileUploadStep({ onTextSubmit, onAIExtraction }: FileUploadStepProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const [extractedItems, setExtractedItems] = useState<PlanItem[] | null>(null);
  const [extractedMappings, setExtractedMappings] = useState<PersonMapping[] | null>(null);
  const [detectedLevels, setDetectedLevels] = useState<PlanLevel[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parsePdfWithEdgeFunction = async (file: File): Promise<string> => {
    setProcessingStatus('Uploading to Cloud...');
    
    const formData = new FormData();
    formData.append('file', file);

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

    setProcessingStatus(`Extracted ${result.pageCount} pages`);
    return result.text;
  };

  const extractPlanItemsWithAI = async (text: string): Promise<void> => {
    setIsExtracting(true);
    setProcessingStatus('AI analyzing document for plan items...');

    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/extract-plan-items`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ documentText: text }),
      });

      if (!response.ok) {
        const error = await response.json();
        if (response.status === 429) {
          throw new Error('AI rate limit reached. Please wait a moment and try again.');
        }
        if (response.status === 402) {
          throw new Error('AI credits exhausted. Please add credits to continue.');
        }
        throw new Error(error.error || 'AI extraction failed');
      }

      const result = await response.json();

      if (!result.success || !result.data) {
        throw new Error(result.error || 'AI extraction returned no data');
      }

      const aiResponse: AIExtractionResponse = result.data;
      
      // Convert detected levels or use defaults
      const levels: PlanLevel[] = aiResponse.detectedLevels?.length > 0
        ? aiResponse.detectedLevels.map((l, idx) => ({
            id: String(idx + 1),
            name: l.name,
            depth: l.depth,
          }))
        : DEFAULT_LEVELS;

      // Convert AI response to PlanItems
      const { items, personMappings } = convertAIResponseToPlanItems(aiResponse, levels);

      setExtractedItems(items);
      setExtractedMappings(personMappings);
      setDetectedLevels(levels);
      
      const itemCount = items.length;
      setProcessingStatus(`Found ${itemCount} trackable plan items`);
      
      toast({
        title: "AI Analysis Complete",
        description: `Extracted ${itemCount} plan items from your document`,
      });

    } catch (error) {
      console.error('AI extraction error:', error);
      toast({
        title: "AI Extraction Issue",
        description: error instanceof Error ? error.message : "Falling back to basic parsing",
        variant: "destructive",
      });
      // Clear extraction results so user can still proceed with basic parsing
      setExtractedItems(null);
      setExtractedMappings(null);
      setDetectedLevels(null);
    } finally {
      setIsExtracting(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    setIsProcessing(true);
    setUploadedFile(file);
    setProcessingStatus('Analyzing file...');
    setExtractedItems(null);
    setExtractedMappings(null);
    setDetectedLevels(null);

    try {
      const fileName = file.name.toLowerCase();
      const isPdf = fileName.endsWith('.pdf');
      const isWord = fileName.endsWith('.doc') || fileName.endsWith('.docx');
      const isExcel = fileName.endsWith('.xls') || fileName.endsWith('.xlsx');
      
      // Text-based files can be read directly
      const textExtensions = ['.txt', '.csv', '.json', '.xml', '.md'];
      const isTextFile = textExtensions.some(ext => fileName.endsWith(ext)) || file.type.startsWith('text/');

      let extractedText = '';

      if (isPdf) {
        // Use edge function for PDF parsing
        extractedText = await parsePdfWithEdgeFunction(file);
        if (!extractedText || extractedText.trim().length === 0) {
          // Fallback to sample if no text extracted
          extractedText = SAMPLE_RAW_TEXT;
          toast({
            title: "Limited text extracted",
            description: "Using sample data - PDF may be image-based",
            variant: "destructive",
          });
        }
      } else if (isWord || isExcel) {
        // Binary office formats - would need server-side processing
        setProcessingStatus('Processing document...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        extractedText = SAMPLE_RAW_TEXT;
        toast({
          title: "Document loaded",
          description: "Using sample data for demo. Full Office support coming soon.",
        });
      } else if (isTextFile) {
        // Read text files directly
        setProcessingStatus('Reading file...');
        const reader = new FileReader();
        
        const content = await new Promise<string>((resolve, reject) => {
          reader.onload = (e) => resolve(e.target?.result as string || '');
          reader.onerror = () => reject(new Error('Failed to read file'));
          reader.readAsText(file);
        });

        extractedText = content && content.length > 0 ? content : SAMPLE_RAW_TEXT;
      } else {
        // Unsupported format
        extractedText = SAMPLE_RAW_TEXT;
        toast({
          title: "Unsupported format",
          description: "Using sample data. Try PDF, TXT, or CSV files.",
          variant: "destructive",
        });
      }

      setFileContent(extractedText);
      setIsProcessing(false);
      
      // Now trigger AI extraction
      await extractPlanItemsWithAI(extractedText);
      
    } catch (error) {
      console.error('File processing error:', error);
      setFileContent(SAMPLE_RAW_TEXT);
      toast({
        title: "Processing failed",
        description: error instanceof Error ? error.message : "Using sample data instead",
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
    // Trigger AI extraction for sample data too
    await extractPlanItemsWithAI(SAMPLE_RAW_TEXT);
  };

  const handleContinue = () => {
    // If we have AI-extracted items, use them via the callback
    if (extractedItems && extractedMappings && detectedLevels && onAIExtraction) {
      onAIExtraction(extractedItems, extractedMappings, detectedLevels);
    } else if (fileContent.trim()) {
      // Fallback to basic text parsing
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

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-4 text-muted-foreground font-medium">Or try a demo</span>
                </div>
              </div>

              <div className="flex justify-center">
                <Button 
                  variant="outline" 
                  onClick={loadSampleData}
                  className="gap-2"
                >
                  <FileText className="h-4 w-4" />
                  Load Sample Strategic Plan
                </Button>
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
                      {isProcessing ? processingStatus || 'Extracting text...' : 'Text extracted'}
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={clearFile} disabled={isLoading}>
                  Remove
                </Button>
              </div>

              {/* AI extraction status */}
              {fileContent && (
                <div className={`flex items-center justify-between p-4 rounded-lg border ${
                  isExtracting 
                    ? 'bg-primary/5 border-primary/20' 
                    : extractedItems 
                      ? 'bg-success/10 border-success/20'
                      : 'bg-muted/50 border-border'
                }`}>
                  <div className="flex items-center gap-3">
                    <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
                      isExtracting 
                        ? 'bg-primary/20' 
                        : extractedItems 
                          ? 'bg-success/20'
                          : 'bg-muted'
                    }`}>
                      {isExtracting ? (
                        <Brain className="h-5 w-5 text-primary animate-pulse" />
                      ) : extractedItems ? (
                        <CheckCircle2 className="h-5 w-5 text-success" />
                      ) : (
                        <AlertCircle className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-foreground">
                        {isExtracting ? 'AI Analysis' : extractedItems ? 'Plan Items Found' : 'Awaiting Analysis'}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {isExtracting 
                          ? processingStatus || 'Identifying trackable items...'
                          : extractedItems 
                            ? `${extractedItems.length} items extracted with AI`
                            : 'Will use basic parsing'
                        }
                      </p>
                    </div>
                  </div>
                  {extractedItems && (
                    <span className="px-2 py-1 text-xs font-medium rounded-full bg-success/20 text-success">
                      AI Enhanced
                    </span>
                  )}
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
            disabled={!fileContent.trim() || isLoading}
            className="w-full h-12 text-base font-medium"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {isExtracting ? 'AI Analyzing...' : 'Processing File...'}
              </>
            ) : extractedItems ? (
              <>
                <Brain className="h-4 w-4 mr-2" />
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
