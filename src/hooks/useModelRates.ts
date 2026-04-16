import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type ModelRates = Record<string, { input: number; output: number }>;

let cachedRates: ModelRates | null = null;
let fetchPromise: Promise<ModelRates> | null = null;

async function fetchRates(): Promise<ModelRates> {
  const { data } = await supabase
    .from('admin_settings')
    .select('value')
    .eq('key', 'model_rates')
    .single();
  const rates = (data?.value as ModelRates) ?? {};
  cachedRates = rates;
  return rates;
}

export function useModelRates() {
  const [rates, setRates] = useState<ModelRates>(cachedRates ?? {});
  const [loading, setLoading] = useState(!cachedRates);

  useEffect(() => {
    if (cachedRates) {
      setRates(cachedRates);
      setLoading(false);
      return;
    }
    if (!fetchPromise) fetchPromise = fetchRates();
    fetchPromise.then(r => {
      setRates(r);
      setLoading(false);
    });
  }, []);

  return { rates, loading };
}

export function invalidateModelRatesCache() {
  cachedRates = null;
  fetchPromise = null;
}
