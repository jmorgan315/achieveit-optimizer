import { useState, useEffect, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Brain, Eye, FileText, CheckCircle2, ChevronDown, Clock, Lightbulb, BarChart3, Sparkles, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ProcessingPhase = 'upload' | 'analysis' | 'verification' | 'vision';

interface ProcessingOverlayProps {
  phase: ProcessingPhase;
  progress: number; // 0-100
  statusMessages: string[];
  industry?: string;
  orgName?: string;
  estimatedSecondsRemaining: number | null;
  isVisionNeeded: boolean;
}

const PHASE_CONFIG: Record<ProcessingPhase, { label: string; icon: typeof Brain; description: string }> = {
  upload: { label: 'Upload & Parse', icon: FileText, description: 'Extracting text from your document...' },
  analysis: { label: 'AI Analysis', icon: Brain, description: 'AI is reading and structuring your plan...' },
  verification: { label: 'Verification', icon: CheckCircle2, description: 'Verifying extraction quality...' },
  vision: { label: 'Vision AI', icon: Eye, description: 'Visual analysis of document pages...' },
};

const PHASE_ORDER: ProcessingPhase[] = ['upload', 'analysis', 'verification', 'vision'];

// Contextual tips organized by category
const GENERAL_TIPS = [
  { icon: Lightbulb, text: "Plans with clearly defined metrics see 40% higher completion rates" },
  { icon: BarChart3, text: "Our AI identifies goals, objectives, strategies, and KPIs in your document" },
  { icon: Sparkles, text: "AchieveIt helps track progress across all plan levels with automated reporting" },
  { icon: Info, text: "Items without owners are 3x more likely to fall behind schedule" },
  { icon: Lightbulb, text: "The best strategic plans have 3-5 levels of hierarchy for clear accountability" },
  { icon: BarChart3, text: "Organizations that track metrics quarterly are 2x more likely to hit targets" },
  { icon: Sparkles, text: "AchieveIt connects your plan items to responsible people and deadlines automatically" },
  { icon: Info, text: "Setting start and due dates on every item improves on-time delivery by 60%" },
];

const INDUSTRY_TIPS: Record<string, { icon: typeof Lightbulb; text: string }[]> = {
  'Local Government': [
    { icon: BarChart3, text: "Local governments typically have 3-5 hierarchy levels in their strategic plans" },
    { icon: Lightbulb, text: "Government plans often include community impact metrics alongside operational KPIs" },
    { icon: Info, text: "Citizen-facing goals benefit from quarterly progress updates for transparency" },
  ],
  'Healthcare': [
    { icon: BarChart3, text: "Healthcare organizations average 4 strategic priority areas in their plans" },
    { icon: Lightbulb, text: "Patient outcome metrics paired with operational goals drive better results" },
    { icon: Info, text: "Compliance-related items should have clear owners and regular review cycles" },
  ],
  'Higher Education': [
    { icon: BarChart3, text: "Universities typically organize plans around academic, operational, and financial pillars" },
    { icon: Lightbulb, text: "Accreditation-aligned metrics help demonstrate institutional effectiveness" },
    { icon: Info, text: "Cross-departmental goals benefit from shared ownership and coordinated timelines" },
  ],
  'K-12 Education': [
    { icon: BarChart3, text: "School districts often align strategic plans with state education standards" },
    { icon: Lightbulb, text: "Student achievement metrics are most effective when tracked at multiple levels" },
    { icon: Info, text: "Community engagement goals strengthen stakeholder buy-in for strategic priorities" },
  ],
  'Financial Services': [
    { icon: BarChart3, text: "Financial institutions typically balance growth metrics with risk management goals" },
    { icon: Lightbulb, text: "Regulatory compliance items need clear ownership and audit-ready documentation" },
  ],
  'Nonprofit': [
    { icon: BarChart3, text: "Nonprofits benefit from tying program metrics to mission-level outcomes" },
    { icon: Lightbulb, text: "Grant-funded initiatives should have milestone tracking aligned to reporting periods" },
  ],
};

function formatTime(seconds: number): string {
  if (seconds < 60) return `~${Math.ceil(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.ceil(seconds % 60);
  return `~${mins}m ${secs}s`;
}

export function ProcessingOverlay({
  phase,
  progress,
  statusMessages,
  industry,
  orgName,
  estimatedSecondsRemaining,
  isVisionNeeded,
}: ProcessingOverlayProps) {
  const [currentTipIndex, setCurrentTipIndex] = useState(0);
  const [tipFading, setTipFading] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [logOpen, setLogOpen] = useState(false);
  const startTimeRef = useRef(Date.now());

  // Build tips list based on industry
  const tips = [
    ...(industry && INDUSTRY_TIPS[industry] ? INDUSTRY_TIPS[industry] : []),
    ...GENERAL_TIPS,
  ];

  // Rotate tips every 8 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setTipFading(true);
      setTimeout(() => {
        setCurrentTipIndex((prev) => (prev + 1) % tips.length);
        setTipFading(false);
      }, 400);
    }, 8000);
    return () => clearInterval(interval);
  }, [tips.length]);

  // Track elapsed time
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const phases = isVisionNeeded ? PHASE_ORDER : PHASE_ORDER.filter(p => p !== 'vision');
  const currentPhaseIndex = phases.indexOf(phase);
  const currentTip = tips[currentTipIndex];
  const TipIcon = currentTip?.icon || Lightbulb;

  return (
    <Card className="border-primary/20 shadow-md overflow-hidden">
      <CardContent className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              {phase === 'vision' ? (
                <Eye className="h-5 w-5 text-primary animate-pulse" />
              ) : (
                <Brain className="h-5 w-5 text-primary animate-pulse" />
              )}
            </div>
            <div>
              <p className="font-semibold text-foreground">
                {orgName ? `Analyzing ${orgName}'s Plan` : 'Analyzing Your Plan'}
              </p>
              <p className="text-sm text-muted-foreground">
                {PHASE_CONFIG[phase].description}
              </p>
            </div>
          </div>
          <div className="text-right text-sm text-muted-foreground space-y-0.5">
            <div className="flex items-center gap-1.5 justify-end">
              <Clock className="h-3.5 w-3.5" />
              <span>{formatTime(elapsedSeconds)} elapsed</span>
            </div>
            {estimatedSecondsRemaining !== null && estimatedSecondsRemaining > 0 && (
              <div className="text-xs text-muted-foreground/70">
                {formatTime(estimatedSecondsRemaining)} remaining
              </div>
            )}
          </div>
        </div>

        {/* Phase indicators */}
        <div className="space-y-3">
          <div className="flex items-center gap-1">
            {phases.map((p, idx) => {
              const config = PHASE_CONFIG[p];
              const Icon = config.icon;
              const isActive = idx === currentPhaseIndex;
              const isDone = idx < currentPhaseIndex;
              return (
                <div key={p} className="flex items-center flex-1">
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
                    <span className="hidden sm:inline truncate">{config.label}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Progress bar */}
          <Progress value={progress} className="h-2.5" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{Math.round(progress)}% complete</span>
            <span>Step {currentPhaseIndex + 1} of {phases.length}</span>
          </div>
        </div>

        {/* Rotating tip card */}
        <div className={cn(
          "rounded-lg bg-muted/50 border border-border p-4 transition-opacity duration-400",
          tipFading ? "opacity-0" : "opacity-100"
        )}>
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
              <TipIcon className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wide mb-1">
                {industry ? `${industry} Insight` : 'Did you know?'}
              </p>
              <p className="text-sm text-foreground leading-relaxed">
                {currentTip?.text}
              </p>
            </div>
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
