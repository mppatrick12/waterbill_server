import { supabase } from '../config/supabase.js';
import { createUnavailableSupabaseClient } from '../config/supabase.js';

// Admin client (explicit) — uses service role key and bypasses RLS for server operations.
const adminSupabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? supabase
    : createUnavailableSupabaseClient('Supabase environment variables are missing for admin device operations.');

export async function listDevices() {
  const { data, error } = await supabase
    .from('meters')
    .select('id, esp32_device_id, device_label, location, flow_rate_threshold, status, last_seen_at, created_at')
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return data || [];
}

export async function createDevice(payload) {
  const { data, error } = await adminSupabase
    .from('meters')
    .insert({
      esp32_device_id: payload.esp32_device_id,
      device_label: payload.device_label || payload.esp32_device_id,
      location: payload.location || null,
      flow_rate_threshold: payload.flow_rate_threshold ?? 50,
      status: 'offline',
      last_seen_at: null,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function setDeviceStatus(deviceId, status, lastSeenAt = new Date().toISOString()) {
  const { data, error } = await adminSupabase
    .from('meters')
    .update({ status, last_seen_at: lastSeenAt })
    .eq('esp32_device_id', deviceId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function upsertDeviceHeartbeat(deviceId, status = 'online') {
  const now = new Date().toISOString();

  // Use admin upsert to atomically insert or update by esp32_device_id to avoid
  // race conditions that can trigger unique constraint violations when
  // concurrent MQTT messages arrive for the same device.
  const { data, error } = await adminSupabase
    .from('meters')
    .upsert(
      {
        esp32_device_id: deviceId,
        device_label: deviceId,
        status,
        last_seen_at: now,
      },
      { onConflict: 'esp32_device_id' }
    )
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}