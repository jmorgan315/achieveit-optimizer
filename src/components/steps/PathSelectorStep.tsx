import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ProcessingPath } from '@/types/plan';
import { Zap, Sparkles, ArrowRight, ArrowLeft } from 'lucide-react';

interface PathSelectorStepProps {
  onSelect: (path: ProcessingPath) => void;
  onBack?: () => void;
}

export function PathSelectorStep({ onSelect, onBack }: PathSelectorStepProps) {
  return (
    <div className="w-full max-w-4xl mx-auto">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-foreground mb-2">
          Choose Your Processing Path
        </h2>
        <p className="text-muted-foreground">
          How would you like to process your strategic plan?
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card 
          className="cursor-pointer transition-all hover:shadow-lg hover:border-primary group"
          onClick={() => onSelect('direct')}
        >
          <CardHeader>
            <div className="h-12 w-12 rounded-lg bg-secondary flex items-center justify-center mb-3 group-hover:bg-primary/10 transition-colors">
              <Zap className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="flex items-center gap-2">
              Direct Mapper
              <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
            </CardTitle>
            <CardDescription>
              My plan is already well-structured. Just format it for AchieveIt import.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="text-sm text-muted-foreground space-y-2">
              <li className="flex items-start gap-2">
                <span className="text-primary">✓</span>
                Quick processing with minimal review
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">✓</span>
                Resolve owner names to emails
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">✓</span>
                Direct export to AchieveIt format
              </li>
            </ul>
            <Button className="w-full mt-6">
              Select Direct Mapper
            </Button>
          </CardContent>
        </Card>

        <Card 
          className="cursor-pointer transition-all hover:shadow-lg hover:border-primary group border-primary/50"
          onClick={() => onSelect('optimizer')}
        >
          <CardHeader>
            <div className="absolute top-4 right-4">
              <span className="text-xs font-medium bg-primary text-primary-foreground px-2 py-1 rounded-full">
                Recommended
              </span>
            </div>
            <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-3 group-hover:bg-primary/20 transition-colors">
              <Sparkles className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="flex items-center gap-2">
              Plan Optimizer
              <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
            </CardTitle>
            <CardDescription>
              Review my plan, identify gaps, and get optimization suggestions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="text-sm text-muted-foreground space-y-2">
              <li className="flex items-start gap-2">
                <span className="text-primary">✓</span>
                Interactive tree view editing
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">✓</span>
                Gap analysis with visual indicators
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">✓</span>
                AI-powered metric suggestions
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">✓</span>
                Drag-and-drop hierarchy fixing
              </li>
            </ul>
            <Button className="w-full mt-6">
              Select Plan Optimizer
            </Button>
          </CardContent>
        </Card>
      </div>

    </div>
  );
}
