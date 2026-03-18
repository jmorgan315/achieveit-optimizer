import { PlanItem } from '@/types/plan';
import { Badge } from '@/components/ui/badge';
import { ShieldCheck, ShieldAlert, ShieldQuestion } from 'lucide-react';

interface ConfidenceBannerProps {
  items: PlanItem[];
}

export function ConfidenceBanner({ items }: ConfidenceBannerProps) {
  if (items.length === 0) return null;

  const avgConfidence = Math.round(
    items.reduce((acc, i) => acc + (i.confidence ?? 100), 0) / items.length
  );

  const highCount = items.filter(i => (i.confidence ?? 100) >= 80).length;
  const needsReview = items.length - highCount;

  const getStyle = () => {
    if (avgConfidence >= 90)
      return {
        icon: ShieldCheck,
        badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
        label: 'High Confidence',
        bg: 'bg-emerald-50 dark:bg-emerald-950/10 border-emerald-200 dark:border-emerald-900',
      };
    if (avgConfidence >= 70)
      return {
        icon: ShieldAlert,
        badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200 dark:border-amber-800',
        label: 'Medium Confidence',
        bg: 'bg-amber-50 dark:bg-amber-950/10 border-amber-200 dark:border-amber-900',
      };
    return {
      icon: ShieldQuestion,
      badge: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-red-200 dark:border-red-800',
      label: 'Review Recommended',
      bg: 'bg-red-50 dark:bg-red-950/10 border-red-200 dark:border-red-900',
    };
  };

  const style = getStyle();
  const Icon = style.icon;

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${style.bg}`}>
      <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="flex items-center gap-3 flex-1">
        <Badge variant="outline" className={`text-xs font-medium ${style.badge}`}>
          {avgConfidence}% — {style.label}
        </Badge>
        <span className="text-sm text-muted-foreground">
          {highCount} of {items.length} items verified with high confidence.
          {needsReview > 0 && ` ${needsReview} item${needsReview > 1 ? 's' : ''} may need review.`}
        </span>
      </div>
    </div>
  );
}
