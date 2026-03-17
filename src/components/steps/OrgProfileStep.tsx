import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Building2, CheckCircle2, XCircle, Globe } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { OrgProfile } from '@/types/plan';
import { supabase } from '@/integrations/supabase/client';

const INDUSTRIES = [
  'Local Government',
  'State Government',
  'Federal Government',
  'Education',
  'Healthcare',
  'Non-Profit',
  'Commercial',
];

interface OrgProfileStepProps {
  onComplete: (profile: OrgProfile) => void;
  onSkip: () => void;
  sessionId?: string;
}

export function OrgProfileStep({ onComplete, onSkip, sessionId }: OrgProfileStepProps) {
  const [orgName, setOrgName] = useState('');
  const [industry, setIndustry] = useState('');
  const [documentHints, setDocumentHints] = useState('');
  const [isLooking, setIsLooking] = useState(false);
  const [lookupResult, setLookupResult] = useState<{
    name: string;
    website: string;
    summary: string;
  } | null>(null);

  const handleLookup = async () => {
    if (!orgName.trim() || !industry) {
      toast({
        title: 'Missing information',
        description: 'Please enter both organization name and industry.',
        variant: 'destructive',
      });
      return;
    }

    setIsLooking(true);
    setLookupResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('lookup-organization', {
        body: { organizationName: orgName.trim(), industry },
      });

      if (error) throw error;

      if (data?.success && data?.result) {
        setLookupResult(data.result);
      } else {
        throw new Error(data?.error || 'Lookup failed');
      }
    } catch (error) {
      console.error('Org lookup error:', error);
      toast({
        title: 'Lookup failed',
        description: 'Could not find organization details. You can still continue with the information provided.',
        variant: 'destructive',
      });
      setLookupResult({
        name: orgName.trim(),
        website: '',
        summary: `${industry} organization`,
      });
    } finally {
      setIsLooking(false);
    }
  };

  const handleConfirm = () => {
    onComplete({
      organizationName: lookupResult?.name || orgName.trim(),
      industry,
      website: lookupResult?.website,
      summary: lookupResult?.summary,
      documentHints: documentHints.trim() || undefined,
      confirmed: true,
    });
  };

  const handleReject = () => {
    setLookupResult(null);
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold">Organization Profile</h2>
        <p className="text-muted-foreground">
          Tell us about your organization so we can provide more relevant recommendations.
        </p>
      </div>

      {!lookupResult ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Organization Details
            </CardTitle>
            <CardDescription>
              This information helps us tailor metric suggestions and optimization to your specific context.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="orgName">Organization Name</Label>
              <Input
                id="orgName"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="e.g., City of Austin"
              />
            </div>

            <div className="space-y-2">
              <Label>Industry</Label>
              <Select value={industry} onValueChange={setIndustry}>
                <SelectTrigger>
                  <SelectValue placeholder="Select industry" />
                </SelectTrigger>
                <SelectContent>
                  {INDUSTRIES.map((ind) => (
                    <SelectItem key={ind} value={ind}>
                      {ind}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="documentHints">
                Any helpful information you'd like to provide about this document?
              </Label>
              <Textarea
                id="documentHints"
                value={documentHints}
                onChange={(e) => setDocumentHints(e.target.value)}
                placeholder={`e.g., "The plan starts on page 8", "We have 5 levels: Pillar, Strategy, Objective, Initiative, KPI", "The plan covers pages 8-22"`}
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                Hints like page ranges, hierarchy levels, or structure notes help our AI extract your plan more accurately.
              </p>
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                onClick={handleLookup}
                disabled={!orgName.trim() || !industry || isLooking}
                className="flex-1"
              >
                {isLooking ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Looking up organization...
                  </>
                ) : (
                  'Continue'
                )}
              </Button>
              <Button variant="ghost" onClick={onSkip}>
                Skip
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              Is this your organization?
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 rounded-lg bg-primary/5 border border-primary/20 space-y-2">
              <h3 className="font-semibold text-lg">{lookupResult.name}</h3>
              {lookupResult.website && (
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <Globe className="h-3 w-3" />
                  {lookupResult.website}
                </p>
              )}
              <p className="text-sm">{lookupResult.summary}</p>
              <p className="text-xs text-muted-foreground mt-2">Industry: {industry}</p>
            </div>

            <div className="flex gap-3">
              <Button onClick={handleConfirm} className="flex-1">
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Yes, this is correct
              </Button>
              <Button variant="outline" onClick={handleReject}>
                <XCircle className="h-4 w-4 mr-2" />
                No, try again
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
