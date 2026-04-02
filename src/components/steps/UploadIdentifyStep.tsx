import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Upload, FileText, Building2, Loader2, X, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { renderPDFToImages } from '@/utils/pdfToImages';
import { LookupResult } from '@/components/steps/OrgProfileStep';
import * as pdfjsLib from 'pdfjs-dist';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

const INDUSTRIES = [
  'Local Government',
  'State Government',
  'Federal Government',
  'Education',
  'Healthcare',
  'Non-Profit',
  'Commercial',
];

const MAX_PDF_PAGES = 250;
const MAX_TEXT_EXTRACTION_SIZE = 8 * 1024 * 1024; // 8MB — skip parse-pdf for larger files

export interface QuickScanResults {
  lookupResult: LookupResult | null;
  parsedText: string | null;
  pageCount: number | null;
  classificationResult: Record<string, unknown> | null;
  pageImages: string[] | null;
  scanErrors: Record<string, string>;
  isSpreadsheet: boolean;
}

interface UploadIdentifyStepProps {
  onComplete: (results: QuickScanResults) => void;
  ensureSessionId: () => Promise<string>;
  sessionId?: string;
  orgName: string; setOrgName: (v: string) => void;
  industry: string; setIndustry: (v: string) => void;
  uploadedFile: File | null; setUploadedFile: (v: File | null) => void;
}

type ScanOp = 'lookup' | 'classify';
type ScanStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

export function UploadIdentifyStep({
  onComplete, ensureSessionId, sessionId,
  orgName, setOrgName,
  industry, setIndustry,
  uploadedFile, setUploadedFile,
}: UploadIdentifyStepProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanStatuses, setScanStatuses] = useState<Record<ScanOp, ScanStatus>>({
    lookup: 'pending', classify: 'pending',
  });
  const [pageCountError, setPageCountError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const safeSet = <T,>(setter: React.Dispatch<React.SetStateAction<T>>, value: T | ((prev: T) => T)) => {
    if (mountedRef.current) setter(value as any);
  };

  const updateStatus = useCallback((op: ScanOp, status: ScanStatus) => {
    safeSet(setScanStatuses, (prev: Record<ScanOp, ScanStatus>) => ({ ...prev, [op]: status }));
  }, []);

  const isPdf = (file: File) => file.name.toLowerCase().endsWith('.pdf');
  const isSpreadsheet = (file: File) => {
    const name = file.name.toLowerCase();
    return name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv');
  };
  const isTextFile = (file: File) => {
    const name = file.name.toLowerCase();
    return name.endsWith('.txt') || name.endsWith('.md') || file.type.startsWith('text/');
  };

  const getPdfPageCount = async (file: File): Promise<number> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    return pdf.numPages;
  };

  const handleFileSelect = async (file: File) => {
    setUploadedFile(file);
    setPageCountError(null);
    setPdfPageCount(null);

    if (isPdf(file)) {
      try {
        const count = await getPdfPageCount(file);
        setPdfPageCount(count);
      } catch (e) {
        console.error('Failed to get PDF page count:', e);
      }
    }
  };

  const clearFile = () => {
    setUploadedFile(null);
    setPdfPageCount(null);
    setPageCountError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleContinue = async () => {
    if (!uploadedFile || !orgName.trim() || !industry) return;

    safeSet(setIsScanning, true);
    safeSet(setPageCountError, null);
    const errors: Record<string, string> = {};

    try {
      const sid = await ensureSessionId();

      // Await session upsert inside try block
      const { error: upsertError } = await supabase.from('processing_sessions').upsert({
        id: sid,
        org_name: orgName.trim(),
        org_industry: industry,
        document_name: uploadedFile.name,
        document_size_bytes: uploadedFile.size,
      }, { onConflict: 'id' });
      if (upsertError) console.error('[UploadIdentify] Session update error:', upsertError);

      // For spreadsheets: only org lookup, then advance
      if (isSpreadsheet(uploadedFile)) {
        safeSet(setScanStatuses, { lookup: 'running', classify: 'skipped' });

        let lookupResult: LookupResult | null = null;
        try {
          const { data, error } = await supabase.functions.invoke('lookup-organization', {
            body: { organizationName: orgName.trim(), industry, sessionId: sid },
          });
          if (error) throw error;
          if (data?.success && data?.result) lookupResult = data.result;
          updateStatus('lookup', 'done');
        } catch (e: any) {
          console.error('Org lookup error:', e);
          errors.lookup = e.message || 'Lookup failed';
          updateStatus('lookup', 'error');
        }

        onComplete({
          lookupResult,
          parsedText: null,
          pageCount: null,
          classificationResult: null,
          pageImages: null,
          scanErrors: errors,
          isSpreadsheet: true,
        });
        return;
      }

      // For text files: read content, org lookup only
      if (isTextFile(uploadedFile)) {
        safeSet(setScanStatuses, { lookup: 'running', parse: 'skipped', classify: 'skipped' });

        let lookupResult: LookupResult | null = null;
        let textContent: string | null = null;

        try {
          textContent = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target?.result as string || '');
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(uploadedFile);
          });
        } catch (e: any) {
          errors.parse = e.message;
        }

        try {
          const { data, error } = await supabase.functions.invoke('lookup-organization', {
            body: { organizationName: orgName.trim(), industry, sessionId: sid },
          });
          if (error) throw error;
          if (data?.success && data?.result) lookupResult = data.result;
          updateStatus('lookup', 'done');
        } catch (e: any) {
          errors.lookup = e.message || 'Lookup failed';
          updateStatus('lookup', 'error');
        }

        onComplete({
          lookupResult,
          parsedText: textContent,
          pageCount: null,
          classificationResult: null,
          pageImages: null,
          scanErrors: errors,
          isSpreadsheet: false,
        });
        return;
      }

      // PDF path: run all 3 in parallel
      safeSet(setScanStatuses, { lookup: 'running', parse: 'running', classify: 'running' });

      let lookupResult: LookupResult | null = null;
      let parsedText: string | null = null;
      let pageCount: number | null = pdfPageCount;
      let classificationResult: Record<string, unknown> | null = null;
      let pageImageUrls: string[] | null = null;

      // Defensive JSON parser — falls back to response.text() on parse failure
      const safeParseJson = async (response: Response): Promise<any> => {
        try {
          return await response.json();
        } catch {
          const text = await response.text();
          throw new Error(text || `HTTP ${response.status}`);
        }
      };

      const results = await Promise.allSettled([
        // Op 1: Org lookup
        (async () => {
          updateStatus('lookup', 'running');
          const { data, error } = await supabase.functions.invoke('lookup-organization', {
            body: { organizationName: orgName.trim(), industry, sessionId: sid },
          });
          if (error) throw error;
          if (data?.success && data?.result) {
            lookupResult = data.result;
          } else {
            lookupResult = { name: orgName.trim(), website: '', summary: `${industry} organization` };
          }
          updateStatus('lookup', 'done');
        })(),

        // Op 2: Parse PDF for text
        (async () => {
          if (uploadedFile.size > MAX_TEXT_EXTRACTION_SIZE) {
            console.log(`[QuickScan] Skipping parse-pdf: file ${(uploadedFile.size / 1024 / 1024).toFixed(1)}MB exceeds ${MAX_TEXT_EXTRACTION_SIZE / 1024 / 1024}MB limit`);
            updateStatus('parse', 'skipped');
            return;
          }
          updateStatus('parse', 'running');
          const formData = new FormData();
          formData.append('file', uploadedFile);
          formData.append('sessionId', sid);

          const response = await fetch(`${SUPABASE_URL}/functions/v1/parse-pdf`, {
            method: 'POST',
            body: formData,
          });
          if (!response.ok) {
            const err = await safeParseJson(response);
            throw new Error(err.error || 'Failed to parse PDF');
          }
          const result = await safeParseJson(response);
          if (!result.success) throw new Error(result.error || 'PDF parsing failed');
          parsedText = result.text;
          pageCount = result.pageCount || pageCount;
          updateStatus('parse', 'done');
        })(),

        // Op 3: Render images + classify
        (async () => {
          updateStatus('classify', 'running');
          const renderResult = await renderPDFToImages(uploadedFile, 250, 0.75);
          pageImageUrls = renderResult.images.map(img => img.dataUrl);
          pageCount = renderResult.pageCount;

          if (renderResult.pageCount > MAX_PDF_PAGES) {
            throw new Error(`PAGE_LIMIT:${renderResult.pageCount}`);
          }

          const response = await fetch(`${SUPABASE_URL}/functions/v1/classify-document`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pageImages: pageImageUrls,
              orgName: orgName.trim(),
              industry,
              sessionId: sid,
            }),
          });
          if (!response.ok) {
            const err = await safeParseJson(response);
            throw new Error(err.error || 'Classification failed');
          }
          const result = await safeParseJson(response);
          if (result.success) {
            classificationResult = result;
          }
          updateStatus('classify', 'done');
        })(),
      ]);

      // Process errors
      let hitPageLimit = false;
      results.forEach((r, idx) => {
        if (r.status === 'rejected') {
          const opNames: ScanOp[] = ['lookup', 'parse', 'classify'];
          const op = opNames[idx];
          const msg = r.reason?.message || String(r.reason);

          if (msg.startsWith('PAGE_LIMIT:')) {
            const count = msg.split(':')[1];
            safeSet(setPageCountError, `This document has ${count} pages. The current limit is ${MAX_PDF_PAGES} pages. Try uploading only the section that contains your strategic plan.`);
            hitPageLimit = true;
            return;
          }

          errors[op] = msg;
          updateStatus(op, 'error');
          console.error(`[QuickScan] ${op} failed:`, msg);
        }
      });

      if (hitPageLimit) return;

      onComplete({
        lookupResult,
        parsedText,
        pageCount,
        classificationResult,
        pageImages: pageImageUrls,
        scanErrors: errors,
        isSpreadsheet: false,
      });
    } catch (err: any) {
      console.error('[UploadIdentify] Unexpected error:', err);
      toast.error('Something went wrong. Please try again.');
    } finally {
      safeSet(setIsScanning, false);
    }
  };

  const canContinue = orgName.trim() !== '' && industry !== '' && uploadedFile !== null;

  const statusLabel = (op: ScanOp): string => {
    const labels: Record<ScanOp, string> = {
      lookup: 'Looking up organization…',
      parse: 'Extracting text…',
      classify: 'Classifying document structure…',
    };
    return labels[op];
  };

  const statusIcon = (status: ScanStatus) => {
    switch (status) {
      case 'running': return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
      case 'done': return <CheckCircle2 className="h-4 w-4 text-green-600" />;
      case 'error': return <AlertTriangle className="h-4 w-4 text-destructive" />;
      default: return <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />;
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6 relative">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-foreground">Upload & Identify</h2>
        <p className="text-muted-foreground">
          Tell us about your organization and upload your strategic plan document.
        </p>
      </div>

      {/* Card 1: Organization Details */}
      <Card className="border-border/50 shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-lg text-foreground">
            <Building2 className="h-5 w-5 text-primary" />
            Organization Details
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            This helps us tailor analysis to your specific context.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="orgName">Organization Name <span className="text-destructive">*</span></Label>
            <Input
              id="orgName"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="e.g., City of Austin"
              disabled={isScanning}
            />
          </div>
          <div className="space-y-2">
            <Label>Industry <span className="text-destructive">*</span></Label>
            <Select value={industry} onValueChange={setIndustry} disabled={isScanning}>
              <SelectTrigger>
                <SelectValue placeholder="Select industry" />
              </SelectTrigger>
              <SelectContent>
                {INDUSTRIES.map((ind) => (
                  <SelectItem key={ind} value={ind}>{ind}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Card 2: File Upload */}
      <Card className="border-border/50 shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-lg text-foreground">
            <Upload className="h-5 w-5 text-primary" />
            Upload Your Strategic Plan
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Upload your plan document for analysis.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!uploadedFile ? (
            <div
              className={`relative border-2 border-dashed rounded-lg p-12 transition-all cursor-pointer ${
                isDragging
                  ? 'border-primary bg-primary/5 scale-[1.01]'
                  : 'border-border hover:border-primary/50 hover:bg-muted/30'
              }`}
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.pdf,.doc,.docx,.xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileSelect(file);
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
          ) : (
            <div className="flex items-center justify-between p-4 rounded-lg bg-primary/5 border border-primary/20">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <FileText className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-foreground">{uploadedFile.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatFileSize(uploadedFile.size)}
                    {pdfPageCount !== null && ` · ${pdfPageCount} pages`}
                  </p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={clearFile} disabled={isScanning}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}

          {/* Page count error */}
          {pageCountError && (
            <div className="p-4 rounded-lg border border-destructive/30 bg-destructive/5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-foreground">Document Too Large</p>
                  <p className="text-sm text-muted-foreground mt-1">{pageCountError}</p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Continue Button */}
      <Button
        onClick={handleContinue}
        disabled={!canContinue || isScanning}
        className="w-full h-12 text-base font-medium"
      >
        {isScanning ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Analyzing…
          </>
        ) : (
          'Continue'
        )}
      </Button>

      {/* Scanning Overlay */}
      {isScanning && (
        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm rounded-lg flex items-center justify-center z-10">
          <Card className="w-full max-w-sm shadow-lg border-border">
            <CardContent className="pt-6 space-y-5">
              <div className="text-center space-y-2">
                <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
                <h3 className="text-lg font-semibold text-foreground">Analyzing your document…</h3>
                <p className="text-sm text-muted-foreground">This usually takes 10-30 seconds</p>
              </div>
              <div className="space-y-3">
                {(['lookup', 'parse', 'classify'] as ScanOp[]).map((op) => {
                  const status = scanStatuses[op];
                  if (status === 'skipped') return null;
                  return (
                    <div key={op} className="flex items-center gap-3">
                      {statusIcon(status)}
                      <span className={`text-sm ${status === 'done' ? 'text-muted-foreground line-through' : status === 'running' ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {status === 'done' ? statusLabel(op).replace('…', '') + '✓' : statusLabel(op)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
