import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Plus, Trash2, Save } from 'lucide-react';
import { format } from 'date-fns';
import { invalidateModelRatesCache } from '@/hooks/useModelRates';

interface RateEntry {
  model: string;
  input: number;
  output: number;
}

export default function SettingsPage() {
  const { toast } = useToast();
  const [entries, setEntries] = useState<RateEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<{ at: string; by: string } | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('admin_settings')
        .select('value, updated_at, updated_by')
        .eq('key', 'model_rates')
        .single();

      if (data) {
        const rates = data.value as Record<string, { input: number; output: number }>;
        setEntries(Object.entries(rates).map(([model, r]) => ({ model, input: r.input, output: r.output })));

        if (data.updated_by) {
          const { data: profile } = await supabase
            .from('user_profiles')
            .select('email, first_name, last_name')
            .eq('id', data.updated_by)
            .single();
          const name = profile ? [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.email : 'Unknown';
          setLastUpdated({ at: data.updated_at, by: name || 'Unknown' });
        } else {
          setLastUpdated({ at: data.updated_at, by: 'System' });
        }
      }
      setLoading(false);
    })();
  }, []);

  const handleSave = async () => {
    const ratesObj: Record<string, { input: number; output: number }> = {};
    for (const e of entries) {
      const key = e.model.trim();
      if (!key) continue;
      ratesObj[key] = { input: e.input, output: e.output };
    }

    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('admin_settings')
      .update({ value: ratesObj as any, updated_at: new Date().toISOString(), updated_by: user?.id })
      .eq('key', 'model_rates');

    if (error) {
      toast({ title: 'Failed to save', description: error.message, variant: 'destructive' });
    } else {
      invalidateModelRatesCache();
      toast({ title: 'Settings saved' });
      if (user?.id) {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('email, first_name, last_name')
          .eq('id', user.id)
          .single();
        const name = profile ? [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.email : 'Unknown';
        setLastUpdated({ at: new Date().toISOString(), by: name || 'Unknown' });
      }
    }
    setSaving(false);
  };

  const addModel = () => setEntries([...entries, { model: '', input: 0, output: 0 }]);

  const removeModel = (idx: number) => setEntries(entries.filter((_, i) => i !== idx));

  const updateEntry = (idx: number, field: keyof RateEntry, value: string) => {
    setEntries(entries.map((e, i) => i === idx ? { ...e, [field]: field === 'model' ? value : Number(value) || 0 } : e));
  };

  if (loading) return <div className="p-6 text-muted-foreground">Loading…</div>;

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <h1 className="text-xl font-semibold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Token Pricing (per million tokens)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-[1fr_120px_120px_40px] gap-2 text-xs font-medium text-muted-foreground">
            <span>Model</span>
            <span>Input ($)</span>
            <span>Output ($)</span>
            <span />
          </div>

          {entries.map((entry, idx) => (
            <div key={idx} className="grid grid-cols-[1fr_120px_120px_40px] gap-2 items-center">
              <Input
                value={entry.model}
                onChange={e => updateEntry(idx, 'model', e.target.value)}
                placeholder="model-name"
                className="h-9 text-sm"
              />
              <Input
                type="number"
                value={entry.input}
                onChange={e => updateEntry(idx, 'input', e.target.value)}
                className="h-9 text-sm"
                min={0}
                step={0.01}
              />
              <Input
                type="number"
                value={entry.output}
                onChange={e => updateEntry(idx, 'output', e.target.value)}
                className="h-9 text-sm"
                min={0}
                step={0.01}
              />
              <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => removeModel(idx)}>
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              </Button>
            </div>
          ))}

          <div className="flex items-center gap-3 pt-2">
            <Button variant="outline" size="sm" onClick={addModel}>
              <Plus className="h-4 w-4 mr-1" /> Add Model
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              <Save className="h-4 w-4 mr-1" /> {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>

          {lastUpdated && (
            <p className="text-xs text-muted-foreground pt-2 border-t border-border">
              Last updated by {lastUpdated.by} on {format(new Date(lastUpdated.at), 'MMM d, yyyy HH:mm')}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
