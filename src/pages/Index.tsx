import { useState } from 'react';
import { Header } from '@/components/Header';
import { supabase } from '@/integrations/supabase/client';
import { WizardProgress } from '@/components/WizardProgress';
import { FileUploadStep } from '@/components/steps/FileUploadStep';
import { OrgProfileStep, LookupResult } from '@/components/steps/OrgProfileStep';
import { LevelVerificationModal } from '@/components/steps/LevelVerificationModal';
import { PeopleMapperStep } from '@/components/steps/PeopleMapperStep';
import { PlanOptimizerStep } from '@/components/steps/PlanOptimizerStep';
import { usePlanState } from '@/hooks/usePlanState';
import { PlanItem, PersonMapping, PlanLevel, OrgProfile, DEFAULT_LEVELS, DedupRemovedDetail } from '@/types/plan';
import { exportToExcel } from '@/utils/exportToExcel';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { ArrowLeft, RotateCcw, Download } from 'lucide-react';
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
  { id: 'org', title: 'Organization' },
  { id: 'upload', title: 'Upload Plan' },
  { id: 'people', title: 'Map People' },
  { id: 'optimize', title: 'Review & Export' },
];

const DEFAULT_LEVEL_NAMES = [
  'Strategic Priority', 'Objective', 'Goal', 'Strategy', 'KPI', 'Action Item', 'Sub-Action',
];

const Index = () => {
  const [currentStep, setCurrentStep] = useState(0);
  const [showLevelModal, setShowLevelModal] = useState(false);
  const [highestCompletedStep, setHighestCompletedStep] = useState(-1);

  const [pendingAIData, setPendingAIData] = useState<{
    items: PlanItem[];
    personMappings: PersonMapping[];
  } | null>(null);

  // === Lifted OrgProfileStep state ===
  const [orgName, setOrgName] = useState('');
  const [industry, setIndustry] = useState('');
  const [documentHints, setDocumentHints] = useState('');
  const [knowsLevels, setKnowsLevels] = useState(false);
  const [levelCount, setLevelCount] = useState(3);
  const [levelNames, setLevelNames] = useState<string[]>(DEFAULT_LEVEL_NAMES.slice(0, 3));
  const [startPage, setStartPage] = useState('');
  const [endPage, setEndPage] = useState('');
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);

  // === Lifted FileUploadStep state ===
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [extractedItems, setExtractedItems] = useState<PlanItem[] | null>(null);
  const [extractedMappings, setExtractedMappings] = useState<PersonMapping[] | null>(null);
  const [detectedLevels, setDetectedLevels] = useState<PlanLevel[] | null>(null);
  const [useVisionAI, setUseVisionAI] = useState(false);
  const [dedupResults, setDedupResults] = useState<DedupRemovedDetail[]>([]);

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
    updateLevelsAndRecalculate,
    changeItemLevel,
    deleteItem,
    resetState,
  } = usePlanState();

  const ensureSessionId = () => {
    if (!state.sessionId) {
      const id = crypto.randomUUID();
      console.log('[Session] Creating new session:', id);
      setSessionId(id);
      supabase.from('processing_sessions').insert({ id, status: 'in_progress' })
        .then(({ error }) => {
          if (error) console.error('[Session] Failed to create session row:', error);
          else console.log('[Session] Row created successfully:', id);
        });
      return id;
    }
    return state.sessionId;
  };

  const goToStep = (step: number) => {
    setCurrentStep(step);
  };

  const handleBack = () => {
    if (currentStep > 0) goToStep(currentStep - 1);
  };

  const handleStartOver = () => {
    resetState();
    setPendingAIData(null);
    // Reset lifted OrgProfileStep state
    setOrgName('');
    setIndustry('');
    setDocumentHints('');
    setKnowsLevels(false);
    setLevelCount(3);
    setLevelNames(DEFAULT_LEVEL_NAMES.slice(0, 3));
    setStartPage('');
    setEndPage('');
    setLookupResult(null);
    // Reset lifted FileUploadStep state
    setUploadedFile(null);
    setFileContent('');
    setExtractedItems(null);
    setExtractedMappings(null);
    setDetectedLevels(null);
    setUseVisionAI(false);
    setHighestCompletedStep(-1);
    setCurrentStep(0);
  };

  const handleStepClick = (stepIndex: number) => {
    if (stepIndex <= highestCompletedStep) goToStep(stepIndex);
  };

  const advanceToStep = (step: number) => {
    setHighestCompletedStep(prev => Math.max(prev, step - 1));
    goToStep(step);
  };

  const handleOrgProfileComplete = (profile: OrgProfile) => {
    setOrgProfile(profile);
    const sid = ensureSessionId();
    // Use upsert to handle race condition — the INSERT from ensureSessionId may not have completed yet
    supabase.from('processing_sessions').upsert({
      id: sid,
      org_name: profile.organizationName,
      org_industry: profile.industry,
    }, { onConflict: 'id' }).then(({ error }) => {
      if (error) console.error('[Session] Failed to update session with org info:', error);
      else console.log('[Session] Org info saved:', profile.organizationName);
    });
    advanceToStep(1);
  };

  const handleOrgProfileSkip = () => {
    setOrgProfile(undefined);
    ensureSessionId();
    advanceToStep(1);
  };

  const handleTextSubmit = (text: string) => {
    setRawText(text);
    setPendingAIData(null);
    setShowLevelModal(true);
  };

  const handleAIExtraction = (items: PlanItem[], personMappings: PersonMapping[], levels: PlanLevel[]) => {
    setLevels(levels);
    setPendingAIData({ items, personMappings });
    setShowLevelModal(true);
  };

  const handleLevelConfirm = (levels: PlanLevel[]) => {
    setLevels(levels);
    
    if (pendingAIData) {
      setItems(pendingAIData.items, pendingAIData.personMappings);
      updateLevelsAndRecalculate(levels);
      setPendingAIData(null);
    } else {
      processText();
    }
    
    advanceToStep(2);
  };

  const handlePeopleMappingComplete = () => {
    applyPersonMappingsToItems();
    advanceToStep(3);
  };

  const handleExport = () => {
    exportToExcel(state.items, state.levels);
    toast({
      title: 'Export Complete',
      description: 'Your AchieveIt import file has been downloaded.',
    });
  };

  const handleUpdateLevels = (levels: PlanLevel[]) => {
    updateLevelsAndRecalculate(levels);
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

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container mx-auto px-4 py-8">
        <WizardProgress steps={WIZARD_STEPS} currentStep={currentStep} completedStep={highestCompletedStep} onStepClick={handleStepClick} />

        {/* Sticky Action Bar */}
        {currentStep > 0 && (
          <div className="sticky top-16 z-40 bg-background/95 backdrop-blur-sm border-b border-border/50 -mx-4 px-4 py-3 mt-4 flex items-center justify-between">
            <Button variant="ghost" onClick={handleBack} size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>

            <div className="flex items-center gap-3">
              {currentStep === 3 && (
                <Button onClick={handleExport} size="sm">
                  <Download className="h-4 w-4 mr-2" />
                  Download AchieveIt Import File
                </Button>
              )}
              {startOverButton}
            </div>
          </div>
        )}

        <div className="mt-8">
          {currentStep === 0 && (
            <OrgProfileStep
              onComplete={handleOrgProfileComplete}
              onSkip={handleOrgProfileSkip}
              sessionId={state.sessionId}
              orgName={orgName} setOrgName={setOrgName}
              industry={industry} setIndustry={setIndustry}
              documentHints={documentHints} setDocumentHints={setDocumentHints}
              knowsLevels={knowsLevels} setKnowsLevels={setKnowsLevels}
              levelCount={levelCount} setLevelCount={setLevelCount}
              levelNames={levelNames} setLevelNames={setLevelNames}
              startPage={startPage} setStartPage={setStartPage}
              endPage={endPage} setEndPage={setEndPage}
              lookupResult={lookupResult} setLookupResult={setLookupResult}
            />
          )}

          {currentStep === 1 && (
            <FileUploadStep
              onTextSubmit={handleTextSubmit}
              onAIExtraction={handleAIExtraction}
              orgProfile={state.orgProfile}
              sessionId={state.sessionId || ensureSessionId()}
              uploadedFile={uploadedFile} setUploadedFile={setUploadedFile}
              fileContent={fileContent} setFileContent={setFileContent}
              extractedItems={extractedItems} setExtractedItems={setExtractedItems}
              extractedMappings={extractedMappings} setExtractedMappings={setExtractedMappings}
              detectedLevels={detectedLevels} setDetectedLevels={setDetectedLevels}
              useVisionAI={useVisionAI} setUseVisionAI={setUseVisionAI}
            />
          )}

          {currentStep === 2 && (
            <PeopleMapperStep
              personMappings={state.personMappings}
              onUpdateMapping={updatePersonMapping}
              onComplete={handlePeopleMappingComplete}
              onBack={handleBack}
            />
          )}

          {currentStep === 3 && (
            <PlanOptimizerStep
              items={state.items}
              levels={state.levels}
              orgProfile={state.orgProfile}
              sessionId={state.sessionId}
              onUpdateItem={updateItem}
              onMoveItem={moveItem}
              onChangeLevel={changeItemLevel}
              onReorderSiblings={reorderSiblings}
              onExport={handleExport}
              onUpdateLevels={handleUpdateLevels}
              onDeleteItem={deleteItem}
              onBack={handleBack}
              onStartOver={handleStartOver}
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
