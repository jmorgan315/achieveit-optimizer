import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

interface WizardStep {
  id: string;
  title: string;
  description?: string;
}

interface WizardProgressProps {
  steps: WizardStep[];
  currentStep: number;
  completedStep?: number;
  onStepClick?: (stepIndex: number) => void;
}

export function WizardProgress({ steps, currentStep, completedStep = -1, onStepClick }: WizardProgressProps) {
  return (
    <div className="w-full py-6">
      <div className="flex items-center justify-between max-w-3xl mx-auto">
        {steps.map((step, index) => {
          const isComplete = index <= completedStep;
          const isCurrent = index === currentStep;
          const isClickable = isComplete && !isCurrent && onStepClick;

          return (
            <div key={step.id} className="flex items-center">
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    'h-10 w-10 rounded-full flex items-center justify-center font-semibold text-sm transition-colors',
                    isComplete && !isCurrent
                      ? 'bg-primary text-primary-foreground'
                      : isCurrent
                      ? 'bg-primary text-primary-foreground ring-4 ring-primary/20'
                      : 'bg-muted text-muted-foreground',
                    isClickable && 'cursor-pointer hover:ring-4 hover:ring-primary/20'
                  )}
                  onClick={() => isClickable && onStepClick?.(index)}
                >
                  {isComplete && !isCurrent ? <Check className="h-5 w-5" /> : index + 1}
                </div>
                <div className="mt-2 text-center">
                  <p
                    className={cn(
                      'text-sm font-medium',
                      isCurrent ? 'text-foreground' : isComplete ? 'text-foreground' : 'text-muted-foreground'
                    )}
                  >
                    {step.title}
                  </p>
                </div>
              </div>

              {index < steps.length - 1 && (
                <div
                  className={cn(
                    'h-0.5 w-16 md:w-24 mx-2',
                    index <= completedStep ? 'bg-primary' : 'bg-muted'
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
