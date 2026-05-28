import { supabase } from '../config/supabase.js';

async function ensureRow() {
  // single-row control; id fixed to 'global'
  const { data, error } = await supabase
    .from('system_controls')
    .select('id')
    .eq('id', 'global')
    .single();

  if (!error && data?.id) return;

  // if row missing, create it
  const { error: insertError } = await supabase
    .from('system_controls')
    .upsert({ id: 'global', water_fetch_enabled: true }, { onConflict: 'id' });

  if (insertError) throw new Error(insertError.message);
}

export async function getWaterFetchEnabled() {
  await ensureRow();
  const { data, error } = await supabase
    .from('system_controls')
    .select('water_fetch_enabled')
    .eq('id', 'global')
    .single();

  if (error) throw new Error(error.message);
  return !!data.water_fetch_enabled;
}

export async function setWaterFetchEnabled(enabled) {
  await ensureRow();
  const { error } = await supabase
    .from('system_controls')
    .update({ water_fetch_enabled: enabled })
    .eq('id', 'global');

  if (error) throw new Error(error.message);
  return enabled;
}

