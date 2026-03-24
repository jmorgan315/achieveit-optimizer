import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Building2, CheckCircle2, XCircle, Globe, Layers, FileText, Plus, Trash2 } from 'lucide-react';
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

const DEFAULT_LEVEL_NAMES = [
  'Strategic Priority',
  'Objective',
  'Goal',
  'Strategy',
  'KPI',
  'Action Item',
  'Sub-Action',
];

export interface LookupResult {
  name: string;
  website: string;
  summary: string;
}

interface OrgProfileStepProps {
  onComplete: (profile: OrgProfile) => void;
  onSkip: () => void;
  sessionId?: string;
  // Lifted state
  orgName: string; setOrgName: (v: string) => void;
  industry: string; setIndustry: (v: string) => void;
  documentHints: string; setDocumentHints: (v: string) => void;
  knowsLevels: boolean; setKnowsLevels: (v: boolean) => void;
  levelCount: number; setLevelCount: (v: number) => void;
  levelNames: string[]; setLevelNames: (v: string[]) => void;
  startPage: string; setStartPage: (v: string) => void;
  endPage: string; setEndPage: (v: string) => void;
  lookupResult: LookupResult | null; setLookupResult: (v: LookupResult | null) => void;
}

export function OrgProfileStep({
  onComplete, onSkip, sessionId,
  orgName, setOrgName,
  industry, setIndustry,
  documentHints, setDocumentHints,
  knowsLevels, setKnowsLevels,
  levelCount, setLevelCount,
  levelNames, setLevelNames,
  startPage, setStartPage,
  endPage, setEndPage,
  lookupResult, setLookupResult,
}: OrgProfileStepProps) {
  const [isLooking, setIsLooking] = useState(false);

  const handleAddLevel = () => {
    if (levelCount >= 7) return;
    const newCount = levelCount + 1;
    setLevelCount(newCount);
    setLevelNames([...levelNames, '']);
  };

  const handleRemoveLevel = (index: number) => {
    if (levelCount <= 1) return;
    const updated = levelNames.filter((_, i) => i !== index);
    setLevelCount(updated.length);
    setLevelNames(updated);
  };

  const updateLevelName = (index: number, name: string) => {
    const updated = [...levelNames];
    updated[index] = name;
    setLevelNames(updated);
  };

  const buildPlanLevels = (): Array<{ depth: number; name: string }> | undefined => {
    if (!knowsLevels) return undefined;
    return levelNames.map((name, idx) => ({ depth: idx + 1, name: name.trim() || `Level ${idx + 1}` }));
  };

  const buildPageRange = (): { startPage: number; endPage: number } | undefined => {
    const s = parseInt(startPage, 10);
    const e = parseInt(endPage, 10);
    if (!s && !e) return undefined;
    if (s && e && s >= e) {
      toast({ title: 'Invalid page range', description: 'Start page must be less than end page.', variant: 'destructive' });
      return undefined;
    }
    if ((s && s < 1) || (e && e < 1)) return undefined;
    return { startPage: s || 1, endPage: e || 9999 };
  };

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
        body: { organizationName: orgName.trim(), industry, sessionId },
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
      planLevels: buildPlanLevels(),
      pageRange: buildPageRange(),
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
        <div className="space-y-4">
          {/* Organization Details Card */}
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
            </CardContent>
          </Card>

          {/* Plan Structure Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Layers className="h-4 w-4 text-primary" />
                Plan Structure
              </CardTitle>
              <CardDescription className="text-sm">
                If you know your plan's hierarchy levels, define them here. Otherwise, our AI will detect them automatically.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="knowsLevels"
                  checked={knowsLevels}
                  onCheckedChange={(checked) => setKnowsLevels(!!checked)}
                />
                <Label htmlFor="knowsLevels" className="text-sm font-normal cursor-pointer">
                  I know my plan's hierarchy levels
                </Label>
              </div>

              {knowsLevels && (
                <div className="space-y-3 pl-6 border-l-2 border-primary/20">
                  <div className="space-y-2">
                    {levelNames.map((name, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-24 flex-shrink-0">
                          Level {idx + 1}{idx === 0 ? ' (highest)' : idx === levelNames.length - 1 ? ' (lowest)' : ''}:
                        </span>
                        <Input
                          value={name}
                          onChange={(e) => updateLevelName(idx, e.target.value)}
                          placeholder={DEFAULT_LEVEL_NAMES[idx] || `Level ${idx + 1}`}
                          className="h-8 text-sm"
                        />
                        {levelNames.length > 1 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                            onClick={() => handleRemoveLevel(idx)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                  {levelCount < 7 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-xs"
                      onClick={handleAddLevel}
                    >
                      <Plus className="h-3 w-3" />
                      Add Level
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Document Scope Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4 text-primary" />
                Document Scope
              </CardTitle>
              <CardDescription className="text-sm">
                If your plan is part of a larger document, tell us which pages contain the actual plan.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 flex-1">
                  <Label htmlFor="startPage" className="text-sm whitespace-nowrap">Plan starts on page</Label>
                  <Input
                    id="startPage"
                    type="number"
                    min="1"
                    value={startPage}
                    onChange={(e) => setStartPage(e.target.value)}
                    placeholder="—"
                    className="h-8 w-20 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2 flex-1">
                  <Label htmlFor="endPage" className="text-sm whitespace-nowrap">Ends on page</Label>
                  <Input
                    id="endPage"
                    type="number"
                    min="1"
                    value={endPage}
                    onChange={(e) => setEndPage(e.target.value)}
                    placeholder="—"
                    className="h-8 w-20 text-sm"
                  />
                </div>
              </div>

              {/* Additional Notes */}
              <div className="space-y-2 pt-2">
                <Label htmlFor="documentHints" className="text-sm">Additional Notes</Label>
                <Textarea
                  id="documentHints"
                  value={documentHints}
                  onChange={(e) => setDocumentHints(e.target.value)}
                  placeholder="Any other context about your document (e.g., 'ignore the appendix', 'metrics are in a separate table on page 30')"
                  rows={2}
                  className="text-sm"
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-3">
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
        </div>
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
