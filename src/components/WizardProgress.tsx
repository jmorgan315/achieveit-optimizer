import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

interface WizardStep {
  id: string;
  title: string;
  shortTitle?: string;
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
    <div className="w-full py-1">
      <div className="flex items-center justify-between max-w-3xl mx-auto relative">
        {/* Background track */}
        <div className="absolute top-2 left-0 right-0 h-0.5 bg-muted rounded-full" />
        {/* Completed track */}
        {completedStep >= 0 && (
          <div
            className="absolute top-2 left-0 h-0.5 bg-primary rounded-full transition-all duration-300"
            style={{ width: `${(completedStep / (steps.length - 1)) * 100}%` }}
          />
        )}

        {steps.map((step, index) => {
          const isComplete = index <= completedStep;
          const isCurrent = index === currentStep;
          const isClickable = isComplete && !isCurrent && onStepClick;

          return (
            <div
              key={step.id}
              className="flex flex-col items-center relative z-10"
              style={{ flex: index === 0 || index === steps.length - 1 ? '0 0 auto' : '1 1 0' }}
            >
              <div
                className={cn(
                  'h-4 w-4 rounded-full flex items-center justify-center transition-colors',
                  isComplete && !isCurrent
                    ? 'bg-primary text-primary-foreground'
                    : isCurrent
                    ? 'bg-primary text-primary-foreground ring-2 ring-primary/30 ring-offset-1 ring-offset-background'
                    : 'bg-muted text-muted-foreground border border-border',
                  isClickable && 'cursor-pointer hover:ring-2 hover:ring-primary/30'
                )}
                onClick={() => isClickable && onStepClick?.(index)}
              >
                {isComplete && !isCurrent ? <Check className="h-2.5 w-2.5" /> : <span className={cn('block h-1.5 w-1.5 rounded-full', isCurrent ? 'bg-primary-foreground' : 'bg-current')} />}
              </div>
              <p
                className={cn(
                  'text-[10px] mt-0.5 whitespace-nowrap',
                  isCurrent ? 'font-medium text-foreground' : isComplete ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {step.shortTitle ? (
                  <>
                    <span className="hidden sm:inline">{step.title}</span>
                    <span className="sm:hidden">{step.shortTitle}</span>
                  </>
                ) : step.title}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
