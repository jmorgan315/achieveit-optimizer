import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

interface FeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  userId: string;
  actualItemCount: number;
  onSubmitted: () => void;
}

const TIME_OPTIONS = [
  'Less than 30 minutes',
  '30-60 minutes',
  '1-2 hours',
  '2-4 hours',
  '4+ hours',
  'Not sure',
];

const RATING_LABELS = ['Poor', 'Fair', 'Good', 'Very Good', 'Excellent'];

function RatingButtons({ value, onChange, label }: { value: number | null; onChange: (v: number) => void; label: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        {RATING_LABELS.map((lbl, i) => {
          const rating = i + 1;
          return (
            <Button
              key={rating}
              type="button"
              variant={value === rating ? 'default' : 'outline'}
              size="sm"
              onClick={() => onChange(rating)}
              className="flex-1"
            >
              <span className="text-xs">{rating}</span>
              <span className="hidden sm:inline text-xs ml-1">– {lbl}</span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}

export function FeedbackDialog({ open, onOpenChange, sessionId, userId, actualItemCount, onSubmitted }: FeedbackDialogProps) {
  const [expectedCount, setExpectedCount] = useState<string>('');
  const [hierarchyRating, setHierarchyRating] = useState<number | null>(null);
  const [overallRating, setOverallRating] = useState<number | null>(null);
  const [timeSaved, setTimeSaved] = useState<string>('');
  const [openFeedback, setOpenFeedback] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    supabase
      .from('session_feedback')
      .select('*')
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setExpectedCount(data.expected_item_count?.toString() ?? '');
          setHierarchyRating(data.hierarchy_rating);
          setOverallRating(data.overall_rating);
          setTimeSaved(data.time_saved ?? '');
          setOpenFeedback(data.open_feedback ?? '');
        } else {
          setExpectedCount('');
          setHierarchyRating(null);
          setOverallRating(null);
          setTimeSaved('');
          setOpenFeedback('');
        }
        setLoading(false);
      });
  }, [open, sessionId, userId]);

  const delta = expectedCount ? actualItemCount - parseInt(expectedCount) : null;
  const deltaLabel = delta !== null
    ? delta > 0 ? `+${delta} more than expected` : delta < 0 ? `${delta} fewer than expected` : 'Exactly as expected'
    : null;

  const handleSubmit = async () => {
    setSaving(true);
    const payload = {
      session_id: sessionId,
      user_id: userId,
      expected_item_count: expectedCount ? parseInt(expectedCount) : null,
      actual_item_count: actualItemCount,
      hierarchy_rating: hierarchyRating,
      overall_rating: overallRating,
      time_saved: timeSaved || null,
      open_feedback: openFeedback || null,
    };

    const { error } = await supabase
      .from('session_feedback')
      .upsert(payload, { onConflict: 'session_id,user_id' });

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Feedback submitted', description: 'Thank you for your feedback!' });
      onSubmitted();
      onOpenChange(false);
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Rate This Import</DialogTitle>
          <DialogDescription>Help us improve by rating the AI's output quality.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Item Count */}
            <div className="space-y-2">
              <Label>The AI extracted {actualItemCount} items. How many were you expecting?</Label>
              <Input
                type="number"
                placeholder="Expected item count"
                value={expectedCount}
                onChange={e => setExpectedCount(e.target.value)}
              />
              {deltaLabel && (
                <p className={`text-sm ${delta! > 0 ? 'text-warning' : delta! < 0 ? 'text-destructive' : 'text-success'}`}>
                  {deltaLabel}
                </p>
              )}
            </div>

            {/* Hierarchy Rating */}
            <RatingButtons
              label="Was the hierarchy structure correct?"
              value={hierarchyRating}
              onChange={setHierarchyRating}
            />

            {/* Overall Rating */}
            <RatingButtons
              label="Overall, how would you rate the AI's output?"
              value={overallRating}
              onChange={setOverallRating}
            />

            {/* Time Saved */}
            <div className="space-y-2">
              <Label>Roughly how long would this have taken manually?</Label>
              <Select value={timeSaved} onValueChange={setTimeSaved}>
                <SelectTrigger>
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  {TIME_OPTIONS.map(opt => (
                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Open Feedback */}
            <div className="space-y-2">
              <Label>What could be improved? (optional)</Label>
              <Textarea
                value={openFeedback}
                onChange={e => setOpenFeedback(e.target.value)}
                placeholder="Any suggestions or issues..."
                rows={3}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving || loading}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Submit Feedback
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
