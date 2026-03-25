import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Brain, CheckCircle2, ChevronDown, Search, GitBranch, FileText, Lightbulb, ScanSearch } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ProcessingStep = 'upload' | 'classify' | 'extract' | 'audit' | 'validate';

interface ProcessingOverlayProps {
  currentStep: ProcessingStep;
  stepProgress: number;
  statusMessages: string[];
  orgName?: string;
  industry?: string;
}

const STEP_CONFIG: { id: ProcessingStep; label: string; icon: typeof Brain }[] = [
  { id: 'upload', label: 'Upload', icon: FileText },
  { id: 'classify', label: 'Classify', icon: ScanSearch },
  { id: 'extract', label: 'Extract', icon: Brain },
  { id: 'audit', label: 'Audit', icon: Search },
  { id: 'validate', label: 'Validate', icon: GitBranch },
];

const STEP_RANGES: Record<ProcessingStep, { start: number; size: number }> = {
  upload: { start: 0, size: 10 },
  classify: { start: 10, size: 10 },
  extract: { start: 20, size: 40 },
  audit: { start: 60, size: 20 },
  validate: { start: 80, size: 20 },
};

const CONTEXTUAL_MESSAGES: Record<ProcessingStep, string> = {
  upload: 'Preparing your document for analysis...',
  classify: 'Analyzing document structure and layout...',
  extract: 'Scanning your document for goals, priorities, and initiatives...',
  audit: 'Cross-checking extracted items against your document...',
  validate: 'Verifying hierarchy and structure...',
};

const INDUSTRY_TIPS: Record<string, string[]> = {
  'Local Government': [
    'Government plans often include community impact metrics alongside operational KPIs — both matter for accountability.',
    'Citizen satisfaction scores are one of the most tracked metrics in local government strategic plans.',
    'The most effective government strategic plans connect department-level work to citywide or countywide goals.',
    'Public sector plans benefit from transparency — publishing progress reports builds community trust.',
  ],
  'State Government': [
    'State-level strategic plans that align agency goals with legislative priorities see stronger budget support.',
    'Cross-agency coordination is the top execution challenge for state government plans — clear ownership at every level helps.',
    'State plans that track both operational efficiency and constituent outcomes tend to have the strongest legislative backing.',
  ],
  'Federal Government': [
    'Federal strategic plans aligned to agency performance frameworks (like GPRA) see better cross-department execution.',
    'The most effective federal plans tie program-level activities directly to mission-level outcomes.',
    'Interagency collaboration on shared priorities is a leading indicator of federal plan success.',
  ],
  'Education': [
    'Education strategic plans that track student outcomes at every level see the strongest long-term results.',
    'Successful education plans connect classroom initiatives to district-wide strategic goals.',
    'Schools that align professional development to strategic priorities see faster progress on achievement gaps.',
  ],
  'Healthcare': [
    'Healthcare organizations that align strategic plans with quality metrics see better patient outcomes and regulatory compliance.',
    'The most common healthcare strategic priorities are patient experience, workforce development, and financial sustainability.',
    'Health systems that cascade strategic goals to department-level action plans see 2x better execution rates.',
  ],
  'Non-Profit': [
    'Nonprofit strategic plans that tie program activities to measurable mission impact are more effective at securing funding.',
    'Board alignment on strategic priorities is the #1 predictor of nonprofit plan execution success.',
    'Nonprofits that review strategic plans quarterly with their board report stronger donor confidence.',
  ],
  'Commercial': [
    'Companies that align department goals with enterprise strategy see 40% better execution rates.',
    'Commercial organizations with cascaded strategic plans report higher employee engagement and faster growth.',
    'The most successful commercial strategic plans balance growth targets with operational efficiency metrics.',
    'Organizations that connect individual performance goals to company strategy see 31% higher productivity.',
  ],
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
  industry,
}: ProcessingOverlayProps) {
  const [logOpen, setLogOpen] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [activeTipIndex, setActiveTipIndex] = useState(0);

  const tips = useMemo(() => (industry && INDUSTRY_TIPS[industry]) || null, [industry]);

  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!tips || tips.length <= 1) return;
    const interval = setInterval(() => {
      setActiveTipIndex((prev) => (prev + 1) % tips.length);
    }, 8000);
    return () => clearInterval(interval);
  }, [tips]);

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

        {/* Contextual tip / status card */}
        <div className="rounded-lg bg-muted/50 border border-border p-4 h-[5.5rem] overflow-hidden">
          {tips ? (
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-full bg-accent/10 flex items-center justify-center shrink-0 mt-0.5">
                <Lightbulb className="h-4 w-4 text-accent-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  {industry} Insight
                </p>
                <p className="text-sm text-foreground leading-relaxed transition-opacity duration-500 line-clamp-2">
                  {tips[activeTipIndex]}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <Brain className="h-4 w-4 text-primary" />
              </div>
              <p className="text-sm text-foreground leading-relaxed">
                {CONTEXTUAL_MESSAGES[currentStep]}
              </p>
            </div>
          )}
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
