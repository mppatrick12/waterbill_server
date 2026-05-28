import mqtt from 'mqtt';
import { claimPendingCardByRfid } from './cardService.js';
import { upsertDeviceHeartbeat } from './deviceService.js';

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

      // Device card tap (card presented at device) -> attempt to find active session for device
      if (topic.startsWith(`${baseTopic}/devices/`) && topic.endsWith('/card-tap')) {
        const parts = topic.split('/');
        const deviceId = parts[2];
        const rfidUid = typeof payload === 'string' ? payload : payload.rfid_uid || payload.uid || payload.card_uid;
        if (!rfidUid) return;
        try {
          const { getCardByUid } = await import('./cardService.js');
          const card = await getCardByUid(String(rfidUid));
          if (!card) return;

          // find latest active session for this device and card
          const { supabase } = await import('../config/supabase.js');
          const { data: sessions, error: sessErr } = await supabase
            .from('water_sessions')
            .select('*')
            .eq('device_id', deviceId)
            .eq('card_id', card.id)
            .eq('status', 'active')
            .order('created_at', { ascending: false })
            .limit(1);

          if (sessErr) throw new Error(sessErr.message);
          const session = sessions && sessions[0];
          if (session) {
            await publishDeviceCommand(deviceId, { action: 'card_authorized', session_id: session.id });
            console.log(`[MQTT] Authorized card tap for session ${session.id} on device ${deviceId}`);
          }
        } catch (err) {
          console.error('[MQTT] card-tap handling failed:', err.message);
        }
        return;
      }

      // Device reports session complete
      if (topic.startsWith(`${baseTopic}/devices/`) && topic.endsWith('/session-complete')) {
        const parts = topic.split('/');
        const deviceId = parts[2];
        const sessionId = payload && (payload.session_id || payload.sessionId || payload.id);
        try {
          if (sessionId) {
            const { completeWaterFetch } = await import('./waterService.js');
            await completeWaterFetch(sessionId);
            console.log(`[MQTT] Session ${sessionId} completed reported by device ${deviceId}`);
          }
        } catch (err) {
          console.error('[MQTT] session-complete handling failed:', err.message);
        }
        return;
      }
    } catch (error) {
      console.error('[MQTT] Message handling failed:', error.message);
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