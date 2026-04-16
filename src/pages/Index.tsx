import { useState, useRef, useCallback, useEffect } from 'react';
import { Header } from '@/components/Header';
import { supabase } from '@/integrations/supabase/client';
import { WizardProgress } from '@/components/WizardProgress';
import { UploadIdentifyStep, QuickScanResults } from '@/components/steps/UploadIdentifyStep';
import { ScanResultsStep, ProcessingConfig } from '@/components/steps/ScanResultsStep';
import { FileUploadStep } from '@/components/steps/FileUploadStep';
import { LookupResult } from '@/components/steps/OrgProfileStep';
import { LevelVerificationModal } from '@/components/steps/LevelVerificationModal';
import { PeopleMapperStep } from '@/components/steps/PeopleMapperStep';
import { PlanOptimizerStep } from '@/components/steps/PlanOptimizerStep';
import { RecentSessionsPage } from '@/components/RecentSessionsPage';
import { LoginPage } from '@/components/LoginPage';
import { useAuth } from '@/hooks/useAuth';
import { usePlanState } from '@/hooks/usePlanState';
import { PlanItem, PersonMapping, PlanLevel, OrgProfile, DEFAULT_LEVELS, DedupRemovedDetail } from '@/types/plan';
import { ReimportHistory } from '@/components/plan-optimizer/ReimportHistoryCard';
import { useAutoSave } from '@/hooks/useAutoSave';
import { convertAIResponseToPlanItems, AIExtractionResponse } from '@/utils/textParser';
import { exportToExcel } from '@/utils/exportToExcel';
import { logActivity } from '@/utils/logActivity';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { ArrowLeft, RotateCcw, Download, List, Loader2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

const WIZARD_STEPS = [
  { id: 'upload-identify', title: 'Upload & Identify', shortTitle: 'Upload' },
  { id: 'configure', title: 'Review & Configure', shortTitle: 'Configure' },
  { id: 'process', title: 'Process' },
  { id: 'people', title: 'Map People', shortTitle: 'People' },
  { id: 'review', title: 'Review & Export', shortTitle: 'Export' },
];

const Index = () => {
  const { user, isAdmin, displayName, featureFlags, loading: authLoading, domainError, signIn, signUp, resetPassword, signOut } = useAuth();
  const [activeView, setActiveView] = useState<'sessions' | 'wizard'>('sessions');
  const [currentStep, setCurrentStep] = useState(0);
  const [showLevelModal, setShowLevelModal] = useState(false);
  const [highestCompletedStep, setHighestCompletedStep] = useState(-1);
  const [isHydrating, setIsHydrating] = useState(false);
  const [resumePollingOnly, setResumePollingOnly] = useState(false);


  const [pendingAIData, setPendingAIData] = useState<{
    items: PlanItem[];
    personMappings: PersonMapping[];
  } | null>(null);

  // === Screen 1 state (UploadIdentifyStep) ===
  const [orgName, setOrgName] = useState('');
  const [industry, setIndustry] = useState('');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);

  // === Quick scan results ===
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
  const [classificationResult, setClassificationResult] = useState<Record<string, unknown> | null>(null);
  const [parsedText, setParsedText] = useState<string | null>(null);
  const [documentPageCount, setDocumentPageCount] = useState<number | null>(null);
  const [pageImages, setPageImages] = useState<string[] | null>(null);
  const [scanErrors, setScanErrors] = useState<Record<string, string>>({});

  // === Processing config from ScanResultsStep ===
  const [processingConfig, setProcessingConfig] = useState<ProcessingConfig | null>(null);

  // === Legacy lifted state for FileUploadStep (bridge) ===
  const [fileContent, setFileContent] = useState('');
  const [extractedItems, setExtractedItems] = useState<PlanItem[] | null>(null);
  const [extractedMappings, setExtractedMappings] = useState<PersonMapping[] | null>(null);
  const [detectedLevels, setDetectedLevels] = useState<PlanLevel[] | null>(null);
  const [useVisionAI, setUseVisionAI] = useState(false);
  const [dedupResults, setDedupResults] = useState<DedupRemovedDetail[]>([]);
  const [reimportHistory, setReimportHistory] = useState<ReimportHistory | null>(null);

  // === Legacy OrgProfileStep state (kept for future screens) ===
  const [documentHints, setDocumentHints] = useState('');
  const [knowsLevels, setKnowsLevels] = useState(false);
  const [levelCount, setLevelCount] = useState(3);
  const [levelNames, setLevelNames] = useState<string[]>(['Strategic Priority', 'Objective', 'Goal']);
  const [startPage, setStartPage] = useState('');
  const [endPage, setEndPage] = useState('');

  const {
    state,
    setLevels,
    setRawText,
    setItems,
    setOrgProfile,
    setSessionId,
    processText,
    updatePersonMapping,
    applyPersonMappingsToItems,
    updateItem,
    moveItem,
    reorderSiblings,
    moveAndReorder,
    updateLevelsAndRecalculate,
    changeItemLevel,
    deleteItem,
    resetState,
  } = usePlanState();

  const saveStatus = useAutoSave(state.items, dedupResults, state.sessionId, state.levels);

  const sessionIdRef = useRef<string | null>(null);
  const sessionPromiseRef = useRef<Promise<string> | null>(null);

  const ensureSessionId = useCallback(async (): Promise<string> => {
    if (sessionIdRef.current) return sessionIdRef.current;
    if (state.sessionId) { sessionIdRef.current = state.sessionId; return state.sessionId; }
    if (sessionPromiseRef.current) return sessionPromiseRef.current;

    sessionPromiseRef.current = (async () => {
      const id = crypto.randomUUID();
      sessionIdRef.current = id;
      console.log('[Session] Creating new session:', id);
      setSessionId(id);
      const upsertPayload: Record<string, unknown> = { id, status: 'in_progress' };
      if (user?.id) upsertPayload.user_id = user.id;
      else console.warn('[Session] user is null at session creation — user_id will be missing');
      const { error } = await supabase.from('processing_sessions').upsert(upsertPayload, { onConflict: 'id' });
      if (error) console.error('[Session] Failed to create session row:', error);
      else console.log('[Session] Row created successfully:', id, 'user_id:', user?.id ?? 'null');
      return id;
    })();

    try {
      return await sessionPromiseRef.current;
    } finally {
      sessionPromiseRef.current = null;
    }
  }, [state.sessionId, setSessionId, user]);

  const goToStep = (step: number) => {
    setCurrentStep(step);
  };

  const handleBack = () => {
    if (currentStep > 0) goToStep(currentStep - 1);
  };

  const handleStartOver = () => {
    sessionIdRef.current = null;
    sessionPromiseRef.current = null;
    resetState();
    setPendingAIData(null);
    setProcessingConfig(null);
    setOrgName('');
    setIndustry('');
    setUploadedFile(null);
    setLookupResult(null);
    setClassificationResult(null);
    setParsedText(null);
    setDocumentPageCount(null);
    setPageImages(null);
    setScanErrors({});
    setFileContent('');
    setExtractedItems(null);
    setExtractedMappings(null);
    setDetectedLevels(null);
    setUseVisionAI(false);
    setDedupResults([]);
    setReimportHistory(null);
    setDocumentHints('');
    setKnowsLevels(false);
    setLevelCount(3);
    setLevelNames(['Strategic Priority', 'Objective', 'Goal']);
    setStartPage('');
    setEndPage('');
    setHighestCompletedStep(-1);
    setCurrentStep(0);
    setResumePollingOnly(false);
    setActiveView('sessions');
  };

  const handleNewImport = () => {
    sessionIdRef.current = null;
    sessionPromiseRef.current = null;
    resetState();
    setPendingAIData(null);
    setProcessingConfig(null);
    setOrgName('');
    setIndustry('');
    setUploadedFile(null);
    setLookupResult(null);
    setClassificationResult(null);
    setParsedText(null);
    setDocumentPageCount(null);
    setPageImages(null);
    setScanErrors({});
    setFileContent('');
    setExtractedItems(null);
    setExtractedMappings(null);
    setDetectedLevels(null);
    setUseVisionAI(false);
    setDedupResults([]);
    setReimportHistory(null);
    setDocumentHints('');
    setKnowsLevels(false);
    setLevelCount(3);
    setLevelNames(['Strategic Priority', 'Objective', 'Goal']);
    setStartPage('');
    setEndPage('');
    setHighestCompletedStep(-1);
    setCurrentStep(0);
    setResumePollingOnly(false);
    setActiveView('wizard');
  };

  const handleSelectSession = async (session: { id: string; org_name: string | null; status: string }) => {
    setIsHydrating(true);
    try {
      // Fetch full session data
      const { data: fullSession, error } = await supabase
        .from('processing_sessions')
        .select('*')
        .eq('id', session.id)
        .single();

      if (error || !fullSession) {
        toast({ title: 'Error', description: 'Failed to load session data.', variant: 'destructive' });
        setIsHydrating(false);
        return;
      }

      // Set session ID
      sessionIdRef.current = fullSession.id;
      setSessionId(fullSession.id);

      // Build org profile
      const profile: OrgProfile = {
        organizationName: fullSession.org_name || '',
        industry: fullSession.org_industry || '',
        confirmed: true,
      };
      setOrgProfile(profile);
      setOrgName(fullSession.org_name || '');
      setIndustry(fullSession.org_industry || '');

      if (fullSession.status === 'completed') {
        // Hydrate items from step_results
        const stepResults = fullSession.step_results as Record<string, unknown> | null;
        const data = stepResults?.data as Record<string, unknown> | undefined;
        const aiItems = data?.items as unknown[];
        const detectedLvls = (data?.detectedLevels as Array<{ depth: number; name: string }>) || [];
        const savedFormat = data?.format as string | undefined;

        if (aiItems && aiItems.length > 0) {
          // Build levels from detected levels
          const levels: PlanLevel[] = detectedLvls.length > 0
            ? detectedLvls.map((l) => ({ id: String(l.depth), name: l.name, depth: l.depth }))
            : DEFAULT_LEVELS;

          // Hydrate dedup results for DedupSummaryCard
          const dedupData = (stepResults?.dedupResults || []) as DedupRemovedDetail[];
          setDedupResults(dedupData);

          // Hydrate reimport history
          const reimportData = stepResults?.reimport as ReimportHistory | undefined;
          setReimportHistory(reimportData ?? null);

          if (savedFormat === 'planItem') {
            // Direct hydration — items already in PlanItem format
            const flattenTree = (nodes: unknown[]): PlanItem[] => {
              const result: PlanItem[] = [];
              for (const node of nodes) {
                const n = node as Record<string, unknown>;
                const children = (n.children as unknown[]) || [];
                const item: PlanItem = {
                  id: (n.id as string) || crypto.randomUUID(),
                  order: (n.order as string) || '',
                  levelName: (n.levelName as string) || '',
                  levelDepth: (n.levelDepth as number) || 1,
                  name: (n.name as string) || '',
                  description: (n.description as string) || '',
                  status: (n.status as PlanItem['status']) || 'Not Started',
                  startDate: (n.startDate as string) || '',
                  dueDate: (n.dueDate as string) || '',
                  assignedTo: (n.assignedTo as string) || '',
                  members: (n.members as string[]) || [],
                  administrators: (n.administrators as string[]) || [],
                  updateFrequency: (n.updateFrequency as PlanItem['updateFrequency']) || '',
                  metricDescription: (n.metricDescription as PlanItem['metricDescription']) || '',
                  metricUnit: (n.metricUnit as PlanItem['metricUnit']) || '',
                  metricRollup: (n.metricRollup as PlanItem['metricRollup']) || '',
                  metricBaseline: (n.metricBaseline as string) || '',
                  metricTarget: (n.metricTarget as string) || '',
                  currentValue: (n.currentValue as string) || '',
                  tags: (n.tags as string[]) || [],
                  parentId: (n.parentId as string | null) ?? null,
                  children: [],
                  issues: [],
                  confidence: n.confidence as number | undefined,
                  corrections: n.corrections as string[] | undefined,
                };
                result.push(item);
                if (children.length > 0) {
                  const childItems = flattenTree(children);
                  // Ensure children have correct parentId
                  childItems.forEach(c => {
                    if (!c.parentId) c.parentId = item.id;
                  });
                  result.push(...childItems);
                }
              }
              return result;
            };

            const items = flattenTree(aiItems);
            setLevels(levels);
            setItems(items, []);
          } else {
            // Legacy path — convert from AI extraction format
            const aiResponse: AIExtractionResponse = {
              items: aiItems as AIExtractionResponse['items'],
              detectedLevels: detectedLvls,
            };
            const { items, personMappings } = convertAIResponseToPlanItems(aiResponse, levels);
            setLevels(levels);
            setItems(items, personMappings);
            updateLevelsAndRecalculate(levels);
          }

          setHighestCompletedStep(3);
          setCurrentStep(4);
          setActiveView('wizard');
        } else {
          // Completed but no items — go to step 4 with empty state
          setHighestCompletedStep(3);
          setCurrentStep(4);
          setActiveView('wizard');
        }
      } else if (fullSession.status === 'in_progress') {
        // For in-progress: jump to processing step, poll only (don't re-trigger handleFileUpload)
        setResumePollingOnly(true);
        setHighestCompletedStep(1);
        setCurrentStep(2);
        setActiveView('wizard');
      } else {
        // Failed or unknown — go to processing step to show error
        setHighestCompletedStep(1);
        setCurrentStep(2);
        setActiveView('wizard');
      }
    } catch (err) {
      console.error('Session hydration error:', err);
      toast({ title: 'Error', description: 'Failed to load session.', variant: 'destructive' });
    } finally {
      setIsHydrating(false);
    }
  };

  const handleStepClick = (stepIndex: number) => {
    if (stepIndex <= highestCompletedStep) goToStep(stepIndex);
  };

  const advanceToStep = (step: number) => {
    setHighestCompletedStep(prev => Math.max(prev, step - 1));
    goToStep(step);
  };

  // === Screen 1 completion handler ===
  const handleQuickScanComplete = (results: QuickScanResults) => {
    // Store scan results
    setLookupResult(results.lookupResult);
    setClassificationResult(results.classificationResult);
    setDocumentPageCount(results.pageCount);
    setPageImages(results.pageImages);
    setScanErrors(results.scanErrors);

    // Build org profile from scan results
    const profile: OrgProfile = {
      organizationName: results.lookupResult?.name || orgName.trim(),
      industry,
      website: results.lookupResult?.website,
      summary: results.lookupResult?.summary,
      confirmed: true,
    };
    setOrgProfile(profile);

    // Check if spreadsheet — skip ScanResultsStep and go directly to processing
    const fileName = uploadedFile?.name?.toLowerCase() || '';
    const isSpreadsheet = fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || fileName.endsWith('.csv');
    if (isSpreadsheet) {
      advanceToStep(2); // Skip configure, go to processing (FileUploadStep handles spreadsheet routing)
    } else {
      advanceToStep(1); // Go to ScanResultsStep
    }
  };

  // === Screen 2 completion handler ===
  const handleStartProcessing = (config: ProcessingConfig) => {
    setProcessingConfig(config);
    setOrgProfile(config.orgProfile);

    // If user defined plan levels, set them now
    if (config.planLevels.length > 0) {
      const configuredLevels: PlanLevel[] = config.planLevels.map((name, i) => ({
        id: String(i + 1),
        name,
        depth: i + 1,
      }));
      setLevels(configuredLevels);
    }

    advanceToStep(2); // Go to processing step (FileUploadStep with autoStart)
  };

  // === Existing handlers (for FileUploadStep bridge) ===
  const handleTextSubmit = (text: string) => {
    setRawText(text);
    setPendingAIData(null);

    if (processingConfig?.planLevels?.length) {
      // User already configured levels on Screen 2 — skip modal
      processText();
      if (state.personMappings.length > 0) {
        advanceToStep(3);
      } else {
        advanceToStep(4);
      }
    } else {
      setShowLevelModal(true);
    }
  };

  const handleAIExtraction = (items: PlanItem[], personMappings: PersonMapping[], levels: PlanLevel[]) => {
    if (processingConfig?.planLevels?.length) {
      // User already configured levels on Screen 2 — skip modal
      const configuredLevels: PlanLevel[] = processingConfig.planLevels.map((name, i) => ({
        id: String(i + 1),
        name,
        depth: i + 1,
      }));
      setLevels(configuredLevels);
      setItems(items, personMappings);
      updateLevelsAndRecalculate(configuredLevels);
      if (personMappings.length > 0) {
        advanceToStep(3);
      } else {
        advanceToStep(4);
      }
    } else {
      setLevels(levels);
      setPendingAIData({ items, personMappings });
      setShowLevelModal(true);
    }
  };

  const handleLevelConfirm = (levels: PlanLevel[]) => {
    setLevels(levels);
    
    if (pendingAIData) {
      setItems(pendingAIData.items, pendingAIData.personMappings);
      updateLevelsAndRecalculate(levels);
      setPendingAIData(null);
      if (pendingAIData.personMappings.length > 0) {
        advanceToStep(3);
      } else {
        advanceToStep(4);
      }
    } else {
      processText();
      advanceToStep(3);
    }
  };

  const handlePeopleMappingComplete = () => {
    applyPersonMappingsToItems();
    advanceToStep(4);
  };

  const handleSpreadsheetComplete = (items: PlanItem[], personMappings: PersonMapping[], levels: PlanLevel[]) => {
    setLevels(levels);
    setItems(items, personMappings);
    if (personMappings.length > 0) {
      advanceToStep(3);
    } else {
      advanceToStep(4);
    }
  };

  const handleExport = () => {
    exportToExcel(state.items, state.levels);
    logActivity('export', { session_id: state.sessionId });
    toast({
      title: 'Export Complete',
      description: 'Your AchieveIt import file has been downloaded.',
    });
  };

  const handleUpdateLevels = (levels: PlanLevel[]) => {
    updateLevelsAndRecalculate(levels);
  };

  const handleDismissDedupItem = (detail: DedupRemovedDetail) => {
    setDedupResults(prev => prev.filter(d => d !== detail));
  };

  const handleRestoreDedupItem = (detail: DedupRemovedDetail) => {
    const raw = detail.removed_item;
    const removedParent = (raw.parent_name as string) || detail.removed_parent || '';
    const keptParent = detail.kept_parent_name || detail.kept_parent || '';

    const normalize = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');
    const firstNWords = (s: string, n: number) => normalize(s).split(' ').slice(0, n).join(' ');

    // Tiered matching: exact → startsWith → first-4-words
    const tieredMatch = (items: PlanItem[], target: string): PlanItem | undefined => {
      if (!target) return undefined;
      const nt = normalize(target);
      const ntWords = firstNWords(target, 4);
      // Tier 1: exact
      let match = items.find(i => normalize(i.name) === nt);
      if (match) return match;
      // Tier 2: startsWith
      match = items.find(i => normalize(i.name).startsWith(nt) || nt.startsWith(normalize(i.name)));
      if (match) return match;
      // Tier 3: first 4 words
      if (ntWords.split(' ').length >= 2) {
        match = items.find(i => firstNWords(i.name, 4) === ntWords);
      }
      return match;
    };

    let parentId: string | null = null;
    let parentDepth = 0;
    let matchPath = 'root (no match)';

    const allItemNames = state.items.map(i => i.name);
    console.log(`[Dedup Restore] Attempting restore of "${detail.removed_name}"`);
    console.log(`[Dedup Restore]   removed_parent: "${removedParent}"`);
    console.log(`[Dedup Restore]   kept_parent: "${keptParent}"`);
    console.log(`[Dedup Restore]   available items (${allItemNames.length}):`, allItemNames);

    // Step 1: Try removed_parent
    if (removedParent) {
      const parent = tieredMatch(state.items, removedParent);
      if (parent) {
        parentId = parent.id;
        parentDepth = parent.levelDepth;
        matchPath = `removed_parent "${removedParent}" → "${parent.name}"`;
      }
    }

    // Step 2: Fallback to kept_parent
    if (!parentId && keptParent) {
      const parent = tieredMatch(state.items, keptParent);
      if (parent) {
        parentId = parent.id;
        parentDepth = parent.levelDepth;
        matchPath = `kept_parent "${keptParent}" → "${parent.name}"`;
      }
    }

    console.log(`[Dedup Restore] "${detail.removed_name}" matched via: ${matchPath}`);

    const levelDepth = parentDepth + 1;
    const levelName = state.levels.find(l => l.depth === levelDepth)?.name || (raw.level_name as string) || (raw.levelType as string) || `Level ${levelDepth}`;

    const newItem: PlanItem = {
      id: crypto.randomUUID(),
      order: '',
      levelName,
      levelDepth,
      name: (raw.name as string) || detail.removed_name,
      description: (raw.description as string) || '',
      status: '' as PlanItem['status'],
      startDate: (raw.start_date as string) || '',
      dueDate: (raw.due_date as string) || '',
      assignedTo: (raw.owner as string) || '',
      members: [],
      administrators: [],
      updateFrequency: '',
      metricDescription: '',
      metricUnit: '',
      metricRollup: '',
      metricBaseline: '',
      metricTarget: '',
      currentValue: '',
      tags: [],
      parentId,
      children: [],
      issues: [],
      confidence: 80,
    };

    // Insert at original position among siblings instead of appending
    const updatedItems = [...state.items];
    const siblings = updatedItems.filter(i => i.parentId === parentId);
    const siblingIndex = detail.removed_sibling_index ?? siblings.length;
    const clampedIndex = Math.min(Math.max(0, siblingIndex), siblings.length);

    if (clampedIndex >= siblings.length) {
      // Insert after last sibling
      if (siblings.length > 0) {
        const lastSiblingIdx = updatedItems.indexOf(siblings[siblings.length - 1]);
        updatedItems.splice(lastSiblingIdx + 1, 0, newItem);
      } else {
        updatedItems.push(newItem);
      }
    } else {
      // Insert before the sibling currently at clampedIndex
      const targetSibling = siblings[clampedIndex];
      const targetIdx = updatedItems.indexOf(targetSibling);
      updatedItems.splice(targetIdx, 0, newItem);
    }

    setItems(updatedItems, state.personMappings);
    updateLevelsAndRecalculate(state.levels);
    setDedupResults(prev => prev.filter(d => d !== detail));

    toast({
      title: 'Item Restored',
      description: `"${newItem.name}" has been added back to the plan.`,
    });
  };

  const startOverButton = (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10">
          <RotateCcw className="h-4 w-4 mr-2" />
          Start Over
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Start over?</AlertDialogTitle>
          <AlertDialogDescription>
            This will discard all your current work including uploaded plans, mappings, and edits. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleStartOver} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            Yes, start over
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  // Loading state
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Not authenticated — show login
  if (!user) {
    return (
      <div className="min-h-screen bg-background">
        <Header user={null} featureFlags={featureFlags} />
        <LoginPage
          onSignIn={signIn}
          onSignUp={signUp}
          onResetPassword={resetPassword}
          domainError={domainError}
        />
      </div>
    );
  }

  if (activeView === 'sessions') {
    return (
      <div className="min-h-screen bg-background">
        <Header user={user} isAdmin={isAdmin} displayName={displayName} onSignOut={async () => { await signOut(); }} featureFlags={featureFlags} />
        <RecentSessionsPage onNewImport={handleNewImport} onSelectSession={handleSelectSession} userId={user.id} isAdmin={isAdmin} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header onHomeClick={() => { setActiveView('sessions'); setCurrentStep(0); }} user={user} isAdmin={isAdmin} displayName={displayName} onSignOut={async () => { await signOut(); }} featureFlags={featureFlags} />

      <main className="container mx-auto px-4 py-8 overflow-x-hidden">
        <div className="space-y-2">
          {/* Stepper row */}
          <div className="flex items-center gap-4">
            {/* Back/Sessions button — hidden on mobile, shown sm+ */}
            <div className="hidden sm:flex shrink-0">
              {currentStep > 0 ? (
                <Button variant="ghost" onClick={handleBack} size="sm">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => setActiveView('sessions')} size="sm">
                  <List className="h-4 w-4 mr-2" />
                  Sessions
                </Button>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <WizardProgress steps={WIZARD_STEPS} currentStep={currentStep} completedStep={highestCompletedStep} onStepClick={handleStepClick} />
            </div>

            {/* Right side buttons — hidden on mobile, shown sm+ */}
            <div className="hidden sm:flex items-center gap-2 shrink-0">
              {currentStep > 0 ? (
                <>
                  {startOverButton}
                </>
              ) : <div className="w-[72px]" />}
            </div>
          </div>

          {/* Mobile nav row — shown only on small screens */}
          <div className="flex sm:hidden items-center justify-between">
            {currentStep > 0 ? (
              <Button variant="ghost" onClick={handleBack} size="sm">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => setActiveView('sessions')} size="sm">
                <List className="h-4 w-4 mr-2" />
                Sessions
              </Button>
            )}
            {currentStep > 0 && startOverButton}
          </div>

        </div>

        <div className="mt-8">
          {currentStep === 0 && (
            <UploadIdentifyStep
              onComplete={handleQuickScanComplete}
              ensureSessionId={ensureSessionId}
              sessionId={state.sessionId ?? sessionIdRef.current ?? undefined}
              orgName={orgName} setOrgName={setOrgName}
              industry={industry} setIndustry={setIndustry}
              uploadedFile={uploadedFile} setUploadedFile={setUploadedFile}
            />
          )}

          {currentStep === 1 && (
            <ScanResultsStep
              lookupResult={lookupResult}
              classificationResult={classificationResult}
              pageCount={documentPageCount}
              scanErrors={scanErrors}
              orgName={orgName}
              industry={industry}
              onStartProcessing={handleStartProcessing}
              onBack={handleBack}
            />
          )}

          {currentStep === 2 && (
            <FileUploadStep
              autoStart={!resumePollingOnly}
              resumePollingOnly={resumePollingOnly}
              onTextSubmit={handleTextSubmit}
              onAIExtraction={handleAIExtraction}
              onSpreadsheetComplete={handleSpreadsheetComplete}
              orgProfile={state.orgProfile}
              classificationResult={classificationResult}
              sessionId={state.sessionId ?? sessionIdRef.current ?? ''}
              hasExistingItems={state.items.length > 0}
              onAdvanceExisting={() => {
                if (state.personMappings.length > 0) {
                  advanceToStep(3);
                } else {
                  advanceToStep(4);
                }
              }}
              uploadedFile={uploadedFile} setUploadedFile={setUploadedFile}
              fileContent={fileContent} setFileContent={setFileContent}
              extractedItems={extractedItems} setExtractedItems={setExtractedItems}
              extractedMappings={extractedMappings} setExtractedMappings={setExtractedMappings}
              detectedLevels={detectedLevels} setDetectedLevels={setDetectedLevels}
              useVisionAI={useVisionAI} setUseVisionAI={setUseVisionAI}
              dedupResults={dedupResults} setDedupResults={setDedupResults}
              pageImages={pageImages} setPageImages={setPageImages}
            />
          )}

          {currentStep === 3 && (
            <PeopleMapperStep
              personMappings={state.personMappings}
              onUpdateMapping={updatePersonMapping}
              onComplete={handlePeopleMappingComplete}
              onBack={handleBack}
            />
          )}

          {currentStep === 4 && (
            <PlanOptimizerStep
              items={state.items}
              levels={state.levels}
              orgProfile={state.orgProfile}
              sessionId={state.sessionId}
              dedupResults={dedupResults}
              reimportHistory={reimportHistory}
              saveStatus={saveStatus}
              userId={user?.id}
              featureFlags={featureFlags}
              initialItemCount={(() => {
                const sr = state.sessionId ? undefined : undefined;
                return undefined;
              })()}
              onUpdateItem={updateItem}
              onMoveItem={moveItem}
              onChangeLevel={changeItemLevel}
              onReorderSiblings={reorderSiblings}
              onMoveAndReorder={moveAndReorder}
              onExport={handleExport}
              onUpdateLevels={handleUpdateLevels}
              onDeleteItem={deleteItem}
              onBack={handleBack}
              onStartOver={handleStartOver}
              onRestoreDedupItem={handleRestoreDedupItem}
              onDismissDedupItem={handleDismissDedupItem}
              onApplyReimport={(newItems) => {
                setItems(newItems, state.personMappings);
                updateLevelsAndRecalculate(state.levels);
                // Refresh reimport history from DB after apply
                if (state.sessionId) {
                  supabase.from('processing_sessions').select('step_results').eq('id', state.sessionId).single().then(({ data }) => {
                    const sr = data?.step_results as Record<string, unknown> | null;
                    setReimportHistory((sr?.reimport as ReimportHistory) ?? null);
                  });
                }
              }}
            />
          )}
        </div>
      </main>

      <LevelVerificationModal
        open={showLevelModal}
        onOpenChange={setShowLevelModal}
        levels={state.levels}
        items={state.items}
        userDefinedLevels={state.orgProfile?.planLevels}
        onConfirm={handleLevelConfirm}
      />
    </div>
  );
};

export default Index;
