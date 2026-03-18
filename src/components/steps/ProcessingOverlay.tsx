import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Brain, CheckCircle2, ChevronDown, Search, GitBranch, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ProcessingStep = 'upload' | 'extract' | 'audit' | 'validate';

interface ProcessingOverlayProps {
  currentStep: ProcessingStep;
  stepProgress: number; // 0-100 within current step
  statusMessages: string[];
  orgName?: string;
}

const STEP_CONFIG: { id: ProcessingStep; label: string; icon: typeof Brain }[] = [
  { id: 'upload', label: 'Upload', icon: FileText },
  { id: 'extract', label: 'Extract', icon: Brain },
  { id: 'audit', label: 'Audit', icon: Search },
  { id: 'validate', label: 'Validate', icon: GitBranch },
];

const STEP_RANGES: Record<ProcessingStep, { start: number; size: number }> = {
  upload: { start: 0, size: 15 },
  extract: { start: 15, size: 45 },
  audit: { start: 60, size: 20 },
  validate: { start: 80, size: 20 },
};

const CONTEXTUAL_MESSAGES: Record<ProcessingStep, string> = {
  upload: 'Preparing your document for analysis...',
  extract: 'Scanning your document for goals, priorities, and initiatives...',
  audit: 'Cross-checking extracted items against your document...',
  validate: 'Verifying hierarchy and structure...',
};

function calcOverallProgress(step: ProcessingStep, stepProgress: number): number {
  const range = STEP_RANGES[step];
  return Math.min(100, range.start + (stepProgress / 100) * range.size);
}

export function ProcessingOverlay({
  currentStep,
  stepProgress,
  statusMessages,
  orgName,
}: ProcessingOverlayProps) {
  const [logOpen, setLogOpen] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const overallProgress = calcOverallProgress(currentStep, stepProgress);
  const currentStepIndex = STEP_CONFIG.findIndex(s => s.id === currentStep);

  const formatElapsed = (s: number) => {
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  };

  return (
    <Card className="border-primary/20 shadow-md overflow-hidden">
      <CardContent className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Brain className="h-5 w-5 text-primary animate-pulse" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-foreground">
              {orgName ? `Analyzing ${orgName}'s Plan` : 'Analyzing Your Plan'}
            </p>
            <p className="text-sm text-muted-foreground">Reviewing your document...</p>
          </div>
          <span className="text-xs text-muted-foreground/40">{formatElapsed(elapsedSeconds)}</span>
        </div>

        {/* Step indicators */}
        <div className="space-y-3">
          <div className="flex items-center gap-1">
            {STEP_CONFIG.map((step, idx) => {
              const Icon = step.icon;
              const isActive = idx === currentStepIndex;
              const isDone = idx < currentStepIndex;
              return (
                <div key={step.id} className="flex items-center flex-1">
                  <div className={cn(
                    "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all w-full justify-center",
                    isActive && "bg-primary/10 text-primary",
                    isDone && "bg-success/10 text-success",
                    !isActive && !isDone && "text-muted-foreground/50"
                  )}>
                    {isDone ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <Icon className={cn("h-3.5 w-3.5 shrink-0", isActive && "animate-pulse")} />
                    )}
                    <span className="hidden sm:inline truncate">{step.label}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <Progress value={overallProgress} className="h-2.5" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{Math.round(overallProgress)}% complete</span>
            <span>Step {currentStepIndex + 1} of {STEP_CONFIG.length}</span>
          </div>
        </div>

        {/* Contextual status card */}
        <div className="rounded-lg bg-muted/50 border border-border p-4">
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
              <Brain className="h-4 w-4 text-primary" />
            </div>
            <p className="text-sm text-foreground leading-relaxed">
              {CONTEXTUAL_MESSAGES[currentStep]}
            </p>
          </div>
        </div>

        {/* Activity log */}
        {statusMessages.length > 0 && (
          <Collapsible open={logOpen} onOpenChange={setLogOpen}>
            <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full">
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", logOpen && "rotate-180")} />
              <span>Activity Log ({statusMessages.length})</span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 max-h-32 overflow-y-auto space-y-1 rounded-md bg-muted/30 p-3">
                {statusMessages.map((msg, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="text-muted-foreground/40 tabular-nums shrink-0">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <span>{msg}</span>
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}
