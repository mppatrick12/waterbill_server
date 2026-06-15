import mqtt from 'mqtt';
import { claimPendingCardByRfid } from './cardService.js';
import { upsertDeviceHeartbeat } from './deviceService.js';
import {
  updateCachedSession,
  getCachedCardData,
  cacheCardData,
  getActiveSessionByCardId,
} from './sessionCache.js';

const brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://broker.hivemq.com:1883';
const baseTopic = process.env.MQTT_BASE_TOPIC || 'waterbill';
let sharedClient = null;

function parsePayload(message) {
  const text = message.toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function startDeviceMqttListener() {
  if (process.env.MQTT_DISABLED === 'true') {
    console.log('[MQTT] Listener disabled by MQTT_DISABLED=true');
    return null;
  }

  const client = mqtt.connect(brokerUrl, {
    clientId: `waterbill-backend-${Math.random().toString(16).slice(2, 10)}`,
    reconnectPeriod: 5000,
  });
  sharedClient = client;

  client.on('connect', () => {
    console.log(`[MQTT] Connected to ${brokerUrl}`);
    client.subscribe([
      `${baseTopic}/devices/+/status`,
      `${baseTopic}/devices/+/heartbeat`,
      `${baseTopic}/cards/register/tap`,
      `${baseTopic}/devices/+/card-tap`,
      `${baseTopic}/devices/+/pump-started`,
      `${baseTopic}/devices/+/session-complete`,
    ]);
  });

  client.on('message', async (topic, message) => {
    try {
      const payload = parsePayload(message);

      if (topic.startsWith(`${baseTopic}/devices/`) && topic.endsWith('/status')) {
        const deviceId = topic.split('/')[2];
        const status = typeof payload === 'string' ? payload : payload.status;
        if (deviceId && ['online', 'offline'].includes(status)) {
          await upsertDeviceHeartbeat(deviceId, status);
        }
        return;
      }

      if (topic.startsWith(`${baseTopic}/devices/`) && topic.endsWith('/heartbeat')) {
        const deviceId = topic.split('/')[2];
        if (deviceId) {
          await upsertDeviceHeartbeat(deviceId, 'online');
        }
        return;
      }

      if (topic === `${baseTopic}/cards/register/tap`) {
        const rfidUid = typeof payload === 'string' ? payload : payload.rfid_uid || payload.uid || payload.card_uid;
        if (rfidUid) {
          const card = await claimPendingCardByRfid(String(rfidUid));
          if (card) {
            console.log(`[MQTT] Registered card ${card.card_uid} to RFID ${rfidUid}`);
          }
        }
        return;
      }

      // Device card tap (card presented at device) -> always send card_status, authorize if active session exists
      if (topic.startsWith(`${baseTopic}/devices/`) && topic.endsWith('/card-tap')) {
        const parts = topic.split('/');
        const deviceId = parts[2];
        const rfidUid = typeof payload === 'string' ? payload : payload.rfid_uid || payload.uid || payload.card_uid;
        if (!rfidUid) return;
        try {
          // ── 1. Resolve card — try in-memory cache first (avoids Supabase round-trip) ──
          let card = getCachedCardData(String(rfidUid));
          if (!card) {
            const { getCardByUid } = await import('./cardService.js');
            card = await getCardByUid(String(rfidUid));
            if (card) cacheCardData(String(rfidUid), card);
          }

          if (!card) {
            await publishDeviceCommand(deviceId, {
              action: 'card_status', rfid_uid: String(rfidUid),
              registered: false, balance_rwf: 0, user_name: null,
              message: 'Card not registered in system',
            });
            console.log(`[MQTT] card-tap: unregistered RFID=${rfidUid}`);
            return;
          }

          // ── 2. Resolve active session — try in-memory index first ──
          let session = getActiveSessionByCardId(card.id);
          let resolvedFromCache = !!session;

          if (!session) {
            // Not in cache — query Supabase (cold path)
            const { supabase } = await import('../config/supabase.js');
            const { data: rows } = await supabase
              .from('water_sessions')
              .select('*')
              .eq('card_id', card.id)
              .eq('status', 'active')
              .order('created_at', { ascending: false })
              .limit(1);
            session = rows && rows[0];
          }

          // Assign device_id if not set (first tap on this device)
          if (session && !session.device_id) {
            updateCachedSession(session.id, { device_id: deviceId });
            const { supabase } = await import('../config/supabase.js');
            supabase.from('water_sessions').update({ device_id: deviceId })
              .eq('id', session.id).then(() => {}).catch(() => {});
            session = { ...session, device_id: deviceId };
          }

          // ── 3. Update card_tapped_at IN CACHE FIRST — frontend sees it on next 150ms poll ──
          if (session) {
            const tappedAt = new Date().toISOString();
            updateCachedSession(session.id, {
              card_tapped_at: tappedAt,
              device_id: session.device_id || deviceId,
            });
            // Persist to DB non-blocking
            const { supabase } = await import('../config/supabase.js');
            supabase.from('water_sessions').update({ card_tapped_at: tappedAt })
              .eq('id', session.id).then(() => {}).catch(() => {});
          }

          // ── 4. Resolve user name — use cached card profile if available ──
          let userName = card._userName || 'Unknown';
          if (userName === 'Unknown' && card.user_id) {
            const { supabase } = await import('../config/supabase.js');
            const { data: profile } = await supabase
              .from('profiles').select('full_name').eq('user_id', card.user_id).single();
            if (profile?.full_name) {
              userName = profile.full_name;
              // Store name on card cache so next tap is instant
              cacheCardData(String(rfidUid), { ...card, _userName: userName });
            }
          }

          // ── 5. Send card_status to device (non-critical, fire & forget) ──
          publishDeviceCommand(deviceId, {
            action: 'card_status', rfid_uid: String(rfidUid),
            registered: true, balance_rwf: Number(card.balance_rwf) || 0,
            user_name: userName, is_active: !!card.is_active, has_session: !!session,
            message: session
              ? `OK - ${userName} | Balance: ${Number(card.balance_rwf).toLocaleString()} RWF`
              : `No active session - ${userName} | Balance: ${Number(card.balance_rwf).toLocaleString()} RWF`,
          }).catch(() => {});

          if (session) {

            await publishDeviceCommand(deviceId, {
              action: 'card_authorized',
              session_id: session.id,
              requested_ml: session.requested_ml || 0,
              rfid_uid: String(rfidUid),
            });
            console.log(`[MQTT] card_authorized sent: session=${session.id} device=${deviceId} ml=${session.requested_ml} user=${userName}`);
          } else {
            console.log(`[MQTT] card_status sent (no session): RFID=${rfidUid} user=${userName} balance=${card.balance_rwf}`);
          }
        } catch (err) {
          console.error('[MQTT] card-tap handling failed:', err.message);
        }
        return;
      }

      // Device reports pump started
      if (topic.startsWith(`${baseTopic}/devices/`) && topic.endsWith('/pump-started')) {
        const sessionId = payload && (payload.session_id || payload.sessionId);
        if (sessionId) {
          const startedAt = new Date().toISOString();
          // Update cache immediately so frontend sees pump state in <150ms
          updateCachedSession(sessionId, { pump_started_at: startedAt });
          try {
            const { supabase } = await import('../config/supabase.js');
            supabase
              .from('water_sessions')
              .update({ pump_started_at: startedAt })
              .eq('id', sessionId)
              .then(() => {})
              .catch(() => {});
            console.log(`[MQTT] Pump started for session ${sessionId}`);
          } catch (err) {
            console.error('[MQTT] pump-started update failed:', err.message);
          }
        }
        return;
      }

      // Device reports session complete
      if (topic.startsWith(`${baseTopic}/devices/`) && topic.endsWith('/session-complete')) {
        const parts = topic.split('/');
        const deviceId = parts[2];
        const sessionId = payload && (payload.session_id || payload.sessionId || payload.id);
        const volumeMl  = payload && (payload.volume_ml  || payload.volumeMl  || 0);
        try {
          if (sessionId) {
            const { supabase } = await import('../config/supabase.js');
            if (volumeMl > 0) {
              // Update cache right away so frontend sees it
              updateCachedSession(sessionId, { volume_ml: volumeMl });
              supabase
                .from('water_sessions')
                .update({ volume_ml: volumeMl })
                .eq('id', sessionId)
                .then(() => {})
                .catch(() => {});
              console.log(`[MQTT] Session ${sessionId}: volume_ml set to ${volumeMl} ml`);
            }
            const { completeWaterFetch } = await import('./waterService.js');
            await completeWaterFetch(sessionId);
            console.log(`[MQTT] Session ${sessionId} completed (device=${deviceId}, volume=${volumeMl} ml)`);
          }
        } catch (err) {
          console.error('[MQTT] session-complete handling failed:', err.message);
        }
        return;
      }
    } catch (error) {
      const isFetchErr = error.message?.includes('fetch failed') || error.message?.includes('timeout') || error.message?.includes('ENOTFOUND');
      if (isFetchErr) {
        console.warn('[MQTT] Message handling skipped — Supabase temporarily unreachable:', error.message);
      } else {
        console.error('[MQTT] Message handling failed:', error.message);
      }
    }
  });

  client.on('error', (error) => {
    console.error('[MQTT] Error:', error.message);
  });

  return client;
}

export async function publishDeviceCommand(deviceId, command) {
  const topic = `${baseTopic}/devices/${deviceId}/command`;
  const payload = typeof command === 'string' ? command : JSON.stringify(command);

  if (sharedClient?.connected) {
    return new Promise((resolve, reject) => {
      sharedClient.publish(topic, payload, { qos: 0, retain: false }, (error) => {
        if (error) reject(error);
        else resolve(true);
      });
    });
  }

  const tempClient = mqtt.connect(brokerUrl, {
    clientId: `waterbill-command-${Math.random().toString(16).slice(2, 10)}`,
    reconnectPeriod: 0,
  });

  return new Promise((resolve, reject) => {
    tempClient.on('connect', () => {
      tempClient.publish(topic, payload, { qos: 0, retain: false }, (error) => {
        tempClient.end(true);
        if (error) reject(error);
        else resolve(true);
      });
    });
    tempClient.on('error', (error) => {
      tempClient.end(true);
      reject(error);
    });
  });
}

export function isMqttConnected() {
  return !!sharedClient && !!sharedClient.connected;
}