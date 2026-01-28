import { useState } from 'react';
import { Header } from '@/components/Header';
import { WizardProgress } from '@/components/WizardProgress';
import { FileUploadStep } from '@/components/steps/FileUploadStep';
import { LevelVerificationModal } from '@/components/steps/LevelVerificationModal';
import { PathSelectorStep } from '@/components/steps/PathSelectorStep';
import { PeopleMapperStep } from '@/components/steps/PeopleMapperStep';
import { PlanOptimizerStep } from '@/components/steps/PlanOptimizerStep';
import { usePlanState } from '@/hooks/usePlanState';
import { ProcessingPath, PlanItem, PersonMapping, PlanLevel } from '@/types/plan';
import { exportToExcel } from '@/utils/exportToExcel';
import { toast } from '@/hooks/use-toast';

const WIZARD_STEPS = [
  { id: 'upload', title: 'Upload Plan' },
  { id: 'path', title: 'Choose Path' },
  { id: 'people', title: 'Map People' },
  { id: 'optimize', title: 'Review & Export' },
];

const Index = () => {
  const [currentStep, setCurrentStep] = useState(0);
  const [showLevelModal, setShowLevelModal] = useState(false);
  
  // Pending AI data - stored temporarily until user confirms levels
  const [pendingAIData, setPendingAIData] = useState<{
    items: PlanItem[];
    personMappings: PersonMapping[];
  } | null>(null);

  const {
    state,
    setLevels,
    setRawText,
    setItems,
    processText,
    setProcessingPath,
    updatePersonMapping,
    applyPersonMappingsToItems,
    updateItem,
    moveItem,
    updateLevelsAndRecalculate,
    changeItemLevel,
  } = usePlanState();

  const handleTextSubmit = (text: string) => {
    setRawText(text);
    setPendingAIData(null); // Clear any pending AI data
    setShowLevelModal(true);
  };

  // Handle AI-extracted items - show level verification modal with detected levels
  const handleAIExtraction = (items: PlanItem[], personMappings: PersonMapping[], levels: PlanLevel[]) => {
    setLevels(levels); // Pre-populate with AI-detected levels
    setPendingAIData({ items, personMappings }); // Store items temporarily
    setShowLevelModal(true); // Show level verification modal
  };

  const handleLevelConfirm = (levels: PlanLevel[]) => {
    setLevels(levels);
    
    if (pendingAIData) {
      // AI extraction path: apply levels to pending items and recalculate order strings
      setItems(pendingAIData.items, pendingAIData.personMappings);
      // Recalculate with the confirmed levels
      updateLevelsAndRecalculate(levels);
      setPendingAIData(null);
    } else {
      // Manual text parsing path
      processText();
    }
    
    setCurrentStep(1);
  };

  const handlePathSelect = (path: ProcessingPath) => {
    setProcessingPath(path);
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
        <WizardProgress steps={WIZARD_STEPS} currentStep={currentStep} />

        <div className="mt-8">
          {currentStep === 0 && (
            <FileUploadStep 
              onTextSubmit={handleTextSubmit} 
              onAIExtraction={handleAIExtraction}
            />
          )}

          {currentStep === 1 && (
            <PathSelectorStep onSelect={handlePathSelect} />
          )}

          {currentStep === 2 && (
            <PeopleMapperStep
              personMappings={state.personMappings}
              onUpdateMapping={updatePersonMapping}
              onComplete={handlePeopleMappingComplete}
            />
          )}

          {currentStep === 3 && (
            <PlanOptimizerStep
              items={state.items}
              levels={state.levels}
              onUpdateItem={updateItem}
              onMoveItem={moveItem}
              onChangeLevel={changeItemLevel}
              onExport={handleExport}
              onUpdateLevels={handleUpdateLevels}
            />
          )}
        </div>
      </main>

      <LevelVerificationModal
        open={showLevelModal}
        onOpenChange={setShowLevelModal}
        levels={state.levels}
        onConfirm={handleLevelConfirm}
      />
    </div>
  );
};

export default Index;
