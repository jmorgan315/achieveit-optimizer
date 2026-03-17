import { useState } from 'react';
import { Header } from '@/components/Header';
import { supabase } from '@/integrations/supabase/client';
import { WizardProgress } from '@/components/WizardProgress';
import { FileUploadStep } from '@/components/steps/FileUploadStep';
import { OrgProfileStep } from '@/components/steps/OrgProfileStep';
import { LevelVerificationModal } from '@/components/steps/LevelVerificationModal';
import { PeopleMapperStep } from '@/components/steps/PeopleMapperStep';
import { PlanOptimizerStep } from '@/components/steps/PlanOptimizerStep';
import { usePlanState } from '@/hooks/usePlanState';
import { PlanItem, PersonMapping, PlanLevel, OrgProfile } from '@/types/plan';
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

const Index = () => {
  const [currentStep, setCurrentStep] = useState(0);
  const [showLevelModal, setShowLevelModal] = useState(false);
  
  const [pendingAIData, setPendingAIData] = useState<{
    items: PlanItem[];
    personMappings: PersonMapping[];
  } | null>(null);

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

  // Generate sessionId when entering the upload step
  const ensureSessionId = () => {
    if (!state.sessionId) {
      const id = crypto.randomUUID();
      setSessionId(id);
      return id;
    }
    return state.sessionId;
  };

  const handleBack = () => {
    if (currentStep > 0) setCurrentStep(currentStep - 1);
  };

  const handleStartOver = () => {
    resetState();
    setPendingAIData(null);
    setCurrentStep(0);
  };

  const handleStepClick = (stepIndex: number) => {
    if (stepIndex < currentStep) setCurrentStep(stepIndex);
  };

  const handleOrgProfileComplete = (profile: OrgProfile) => {
    setOrgProfile(profile);
    ensureSessionId();
    setCurrentStep(1);
  };

  const handleOrgProfileSkip = () => {
    setOrgProfile(undefined);
    ensureSessionId();
    setCurrentStep(1);
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
    
    // Go to people mapper step
    setCurrentStep(2);
  };

  const handlePeopleMappingComplete = () => {
    applyPersonMappingsToItems();
    setCurrentStep(3);
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

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container mx-auto px-4 py-8">
        <WizardProgress steps={WIZARD_STEPS} currentStep={currentStep} onStepClick={handleStepClick} />

        {/* Sticky Action Bar */}
        {currentStep > 0 && (
          <div className="sticky top-16 z-40 bg-background/95 backdrop-blur-sm border-b border-border/50 -mx-4 px-4 py-3 mt-4 flex items-center justify-between">
            <Button variant="ghost" onClick={handleBack} size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>

            <div className="flex items-center gap-3">
              {currentStep === 3 && (
                <>
                  <Button onClick={handleExport} size="sm">
                    <Download className="h-4 w-4 mr-2" />
                    Download AchieveIt Import File
                  </Button>
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
                </>
              )}
            </div>
          </div>
        )}

        <div className="mt-8">
          {currentStep === 0 && (
            <OrgProfileStep
              onComplete={handleOrgProfileComplete}
              onSkip={handleOrgProfileSkip}
              sessionId={state.sessionId}
            />
          )}

          {currentStep === 1 && (
            <FileUploadStep 
              onTextSubmit={handleTextSubmit} 
              onAIExtraction={handleAIExtraction}
              orgProfile={state.orgProfile}
              sessionId={state.sessionId || ensureSessionId()}
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
        onConfirm={handleLevelConfirm}
      />
    </div>
  );
};

export default Index;
