import { supabase } from '../config/supabase.js';
import { authorizeWaterFetch, completeWaterFetch, recordFlowTick } from './waterService.js';
import { getCardByUid } from './cardService.js';

export async function queueSyncEvent(deviceId, payload) {
  const { data, error } = await supabase
    .from('device_sync_queue')
    .insert({
      device_id: deviceId,
      payload_json: payload,
      synced: false,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function processBatchSync(deviceId, events) {
  const results = { synced: 0, failed: [], details: [] };

  const sorted = [...events].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  for (const event of sorted) {
    try {
      const idempotencyKey = `${deviceId}-${event.timestamp}-${event.type}`;

      const { data: existing } = await supabase
        .from('device_sync_queue')
        .select('id')
        .eq('idempotency_key', idempotencyKey)
        .single();

      if (existing) {
        results.details.push({ event, status: 'duplicate_skipped' });
        continue;
      }

      let result;
      switch (event.type) {
        case 'authorize':
          result = await authorizeWaterFetch({
            cardUid: event.card_uid,
            requestedMl: event.requested_ml,
            meterId: event.meter_id,
            deviceId,
          });
          break;
        case 'flow_tick':
          result = await recordFlowTick({
            sessionId: event.session_id,
            volumeMl: event.volume_ml,
            flowRateMlPerSec: event.flow_rate,
          });
          break;
        case 'complete':
          result = await completeWaterFetch(event.session_id);
          break;
        case 'identify':
          result = await getCardByUid(event.card_uid);
          break;
        default:
          throw new Error(`Unknown event type: ${event.type}`);
      }

      await supabase.from('device_sync_queue').insert({
        device_id: deviceId,
        payload_json: event,
        idempotency_key: idempotencyKey,
        synced: true,
        synced_at: new Date().toISOString(),
      });

      results.synced++;
      results.details.push({ event, status: 'ok', result });
    } catch (err) {
      results.failed.push({ event, error: err.message });
      await queueSyncEvent(deviceId, { ...event, sync_error: err.message });
    }
  }

  return results;
}

export async function getPendingSync(deviceId) {
  const { data, error } = await supabase
    .from('device_sync_queue')
    .select('*')
    .eq('device_id', deviceId)
    .eq('synced', false)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data;
}
