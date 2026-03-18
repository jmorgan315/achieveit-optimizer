import { PlanItem } from '@/types/plan';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

interface ConfidencePopoverProps {
  item: PlanItem;
  sessionId?: string;
  children: React.ReactNode;
}

export function isUserOverride(correction: string): boolean {
  return correction.startsWith('[user-override]');
}

export function hasDiscrepancy(item: PlanItem): boolean {
  if (!item.corrections || item.corrections.length === 0) return false;
  // Ignore user-override corrections
  const agentCorrections = item.corrections.filter(c => !isUserOverride(c));
  if (agentCorrections.length === 0) return false;
  if ((item.confidence ?? 100) <= 20) return true;
  const hasAudit = agentCorrections.some(c => /agent\s*2|completeness|audit/i.test(c));
  const hasValidation = agentCorrections.some(c => /agent\s*3|hierarchy|validation|validator/i.test(c));
  return hasAudit && hasValidation;
}

export function getConfidenceColor(confidence: number): { dot: string; bg: string; text: string; label: string } {
  if (confidence >= 80) return { dot: 'bg-emerald-500', bg: '', text: 'text-emerald-600', label: 'High' };
  if (confidence >= 50) return { dot: 'bg-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/20', text: 'text-amber-600', label: 'Medium' };
  return { dot: 'bg-destructive', bg: 'bg-destructive/5', text: 'text-destructive', label: 'Low' };
}

export function ConfidencePopover({ item, sessionId, children }: ConfidencePopoverProps) {
  const confidence = item.confidence ?? 100;
  const color = getConfidenceColor(confidence);
  const corrections = item.corrections ?? [];
  const discrepancy = hasDiscrepancy(item);

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="p-4 space-y-3">
          {/* Score header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`h-3 w-3 rounded-full ${color.dot}`} />
              <span className="font-medium text-sm">Confidence: {confidence}%</span>
            </div>
            <Badge variant="outline" className={`text-xs ${color.text}`}>
              {color.label}
            </Badge>
          </div>

          {/* Discrepancy warning */}
          {discrepancy && (
            <div className="flex items-start gap-2 p-2 rounded-md bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800">
              <AlertTriangle className="h-4 w-4 text-orange-500 mt-0.5 shrink-0" />
              <p className="text-xs text-orange-700 dark:text-orange-400">
                Agents disagreed on this item. Review the corrections below for details.
              </p>
            </div>
          )}

          {/* Corrections list */}
          {corrections.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Corrections</p>
              {corrections.map((c, i) => {
                const override = isUserOverride(c);
                const displayText = c.replace(/^\[(user-override|agent-correction)\]\s*/, '');
                return (
                  <div key={i} className={`flex items-start gap-2 text-xs ${override ? 'text-muted-foreground' : 'text-foreground'}`}>
                    <ArrowRight className={`h-3 w-3 mt-0.5 shrink-0 ${override ? 'text-muted-foreground/50' : 'text-muted-foreground'}`} />
                    <span>{override ? `Level updated to match your plan structure` : displayText}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No corrections — extracted cleanly.</p>
          )}

          {/* Admin link */}
          {sessionId && (
            <Link
              to={`/admin/sessions/${sessionId}`}
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              View in Admin Logs →
            </Link>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
