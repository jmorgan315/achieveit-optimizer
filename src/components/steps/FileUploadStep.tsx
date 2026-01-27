import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Upload, FileText, ClipboardPaste } from 'lucide-react';
import { SAMPLE_RAW_TEXT } from '@/types/plan';

interface FileUploadStepProps {
  onTextSubmit: (text: string) => void;
}

export function FileUploadStep({ onTextSubmit }: FileUploadStepProps) {
  const [text, setText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (file: File) => {
    // Only process text files - binary formats (PDF, DOC, XLSX) need server-side processing
    const textExtensions = ['.txt', '.csv', '.json', '.xml', '.md'];
    const isTextFile = textExtensions.some(ext => file.name.toLowerCase().endsWith(ext)) 
      || file.type.startsWith('text/');
    
    if (!isTextFile) {
      // For non-text files, show a message and load sample data for demo
      setText(`[File "${file.name}" uploaded - binary format detected]\n\nFor this demo, binary files (PDF, Word, Excel) would be processed server-side.\nLoading sample data to demonstrate the workflow:\n\n` + SAMPLE_RAW_TEXT);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (content && content.length > 0) {
        setText(content);
      } else {
        setText(SAMPLE_RAW_TEXT);
      }
    };
    reader.onerror = () => {
      setText(SAMPLE_RAW_TEXT);
    };
    reader.readAsText(file);
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

  const loadSampleData = () => {
    setText(SAMPLE_RAW_TEXT);
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl">
            <Upload className="h-6 w-6 text-primary" />
            Upload Your Strategic Plan
          </CardTitle>
          <CardDescription>
            Paste your plan text, upload a file, or try our sample data to see how AchieveIt Strategy Consultant works.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div
            className={`relative border-2 border-dashed rounded-lg p-8 transition-colors cursor-pointer ${
              isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
            }`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.pdf,.doc,.docx,.xlsx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileUpload(file);
              }}
            />
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <FileText className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="font-medium text-foreground">
                  Drag and drop your file here
                </p>
                <p className="text-sm text-muted-foreground">
                  Supports PDF, Word, Excel, and text files
                </p>
              </div>
            </div>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">Or paste your content</span>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-foreground flex items-center gap-2">
                <ClipboardPaste className="h-4 w-4" />
                Plan Text
              </label>
              <Button variant="outline" size="sm" onClick={loadSampleData}>
                Load Sample Data
              </Button>
            </div>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste your strategic plan content here..."
              className="min-h-[250px] font-mono text-sm"
            />
          </div>

          <Button
            onClick={() => onTextSubmit(text)}
            disabled={!text.trim()}
            className="w-full h-12 text-base"
          >
            Continue to Level Verification
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
