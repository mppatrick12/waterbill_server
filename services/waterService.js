import { supabase } from '../config/supabase.js';
import { SESSION_STATUS, ROLES, ACCOUNT_STATUS } from '../config/constants.js';
import { calculateCost } from './pricingService.js';
import { publishDeviceCommand } from './mqttService.js';
import { getCardByUid, deductBalance, reserveAndCheck, getProfileByUserId } from './cardService.js';
import { processFlowTick } from './leakDetectionService.js';
import { updateDailyUsage } from './analyticsService.js';
import { createSystemNotification, notifyAdmins } from '../controllers/notificationController.js';
import { cacheSession, updateCachedSession, evictSession, cacheCardData } from './sessionCache.js';
import { sendEmail, buildDispenseEmail } from './emailService.js';

export async function identifyCard(cardUid) {
  const card = await getCardByUid(cardUid);
  if (!card) return { found: false };
  if (card.registration_status !== 'registered' || !card.user_id) {
    return { found: false, reason: 'CARD_NOT_REGISTERED' };
  }

  const profile = await getProfileByUserId(card.user_id);
  const fullProfile = await supabase
    .from('profiles')
    .select('account_status, role')
    .eq('user_id', card.user_id)
    .single();

  const p = fullProfile.data;
  if (
    p?.role === ROLES.CUSTOMER &&
    (p.account_status || ACCOUNT_STATUS.APPROVED) !== ACCOUNT_STATUS.APPROVED
  ) {
    return { found: false, reason: 'ACCOUNT_NOT_APPROVED' };
  }

  return {
    found: true,
    card: {
      id: card.id,
      user_id: card.user_id,
      balance_rwf: card.balance_rwf,
      card_uid: card.card_uid,
      is_active: card.is_active,
    },
    user: profile,
  };
}

export async function authorizeWaterFetch({ cardUid, requestedMl, meterId, deviceId }) {
  // Admin system switch: if water fetching is stopped, block authorization completely.
  const enabled = await (await import('./systemControlService.js')).getWaterFetchEnabled();
  if (!enabled) {
    return {
      success: false,
      reason: 'SYSTEM_WATER_FETCH_DISABLED',
      message: 'Water fetching is stopped by admin.',
    };
  }

  const card = await getCardByUid(cardUid);
  if (!card) throw new Error('CARD_NOT_FOUND');
  if (!card.is_active) throw new Error('CARD_INACTIVE');
  if (card.registration_status !== 'registered' || !card.user_id) {
    return {
      success: false,
      reason: 'CARD_NOT_REGISTERED',
      message: 'Card must be registered and assigned to a user before it can authorize water fetches.',
    };
  }

  const { data: ownerProfile } = await supabase
    .from('profiles')
    .select('role, account_status')
    .eq('user_id', card.user_id)
    .single();

  if (
    ownerProfile?.role === ROLES.CUSTOMER &&
    (ownerProfile.account_status || ACCOUNT_STATUS.APPROVED) !== ACCOUNT_STATUS.APPROVED
  ) {
    return {
      success: false,
      reason: 'ACCOUNT_NOT_APPROVED',
      message: 'Customer account is not approved by WASAC manager.',
    };
  }

  const check = await reserveAndCheck(card, requestedMl);
  if (!check.allowed) {
    await supabase.from('water_sessions').insert({
      user_id: card.user_id,
      card_id: card.id,
      meter_id: meterId || null,
      volume_ml: 0,
      cost_rwf: 0,
      requested_ml: requestedMl,
      status: SESSION_STATUS.BLOCKED,
      device_id: deviceId,
    });
    return { success: false, ...check };
  }

  // If deviceId not supplied, try to find a meter (device) assigned to the card owner
  if (!deviceId) {
    try {
      const { data: meter } = await supabase
        .from('meters')
        .select('esp32_device_id')
        .eq('user_id', card.user_id)
        .limit(1)
        .maybeSingle();
      if (meter && meter.esp32_device_id) deviceId = meter.esp32_device_id;
    } catch (err) {
      // ignore
    }
  }

  // Last resort: broadcast to all registered online devices so the nearest kiosk picks it up
  if (!deviceId) {
    try {
      const { data: devices } = await supabase
        .from('devices')
        .select('device_id')
        .eq('status', 'online')
        .limit(5);
      if (devices && devices.length > 0) {
        deviceId = devices[0].device_id; // primary target
      }
    } catch (err) {
      // ignore
    }
  }

  const { data: session, error } = await supabase
    .from('water_sessions')
    .insert({
      user_id: card.user_id,
      card_id: card.id,
      meter_id: meterId || null,
      volume_ml: 0,
      cost_rwf: 0,
      requested_ml: requestedMl,
      reserved_cost_rwf: check.estimatedCost,
      status: SESSION_STATUS.ACTIVE,
      started_at: new Date().toISOString(),
      device_id: deviceId,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  // Populate in-memory cache so getSessionById responds instantly (no Supabase round-trip)
  cacheSession(session);
  // Cache card data so MQTT card-tap handler avoids a Supabase lookup
  cacheCardData(card.rfid_uid, card);

  // Notify device (if provided) to prepare for dispense — non-blocking
  if (deviceId) {
    (async () => {
      try {
        await publishDeviceCommand(deviceId, {
          action: 'prepare_dispense',
          session_id: session.id,
          requested_ml: requestedMl,
          rfid_uid: card.rfid_uid,
        });
      } catch (err) {
        console.error('[MQTT] Failed to publish prepare_dispense:', err.message);
      }
    })();
  }
  return {
    success: true,
    session,
    estimatedCost: check.estimatedCost,
    balance: check.balance,
    message: 'Water fetch authorized. Valve may open.',
  };
}

export async function recordFlowTick({ sessionId, volumeMl, flowRateMlPerSec }) {
  const { data: session, error } = await supabase
    .from('water_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();

  if (error || !session) throw new Error('SESSION_NOT_FOUND');
  if (session.status !== SESSION_STATUS.ACTIVE) throw new Error('SESSION_NOT_ACTIVE');

  const newVolume = Math.max(session.volume_ml, volumeMl);
  const currentCost = calculateCost(newVolume);

  const { data: updated, error: updateError } = await supabase
    .from('water_sessions')
    .update({
      volume_ml: newVolume,
      cost_rwf: currentCost,
      last_flow_rate: flowRateMlPerSec,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId)
    .select()
    .single();

  if (updateError) throw new Error(updateError.message);

  const leakResult = await processFlowTick(updated, {
    flow_rate_ml_per_sec: flowRateMlPerSec,
  });

  const { data: cardData } = await supabase.from('cards').select('balance_rwf').eq('id', session.card_id).single();

  if (cardData && currentCost > cardData.balance_rwf) {
    return {
      session: updated,
      leak: leakResult,
      valveOpen: false,
      reason: 'INSUFFICIENT_BALANCE_MID_SESSION',
    };
  }

  return { session: updated, leak: leakResult, valveOpen: true };
}

export async function completeWaterFetch(sessionId) {
  const { data: session, error } = await supabase
    .from('water_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();

  if (error || !session) throw new Error('SESSION_NOT_FOUND');

  // Fallback: if flow sensor gave no pulses (volume_ml=0) but pump actually ran,
  // use requested_ml so the user gets charged correctly
  let actualVolumeMl = session.volume_ml || 0;
  if (actualVolumeMl === 0 && (session.requested_ml || 0) > 0) {
    actualVolumeMl = session.requested_ml;
    // Save the fallback volume so getSession also returns correct data
    await supabase
      .from('water_sessions')
      .update({ volume_ml: actualVolumeMl })
      .eq('id', sessionId);
    console.log(`[Water] Session ${sessionId}: volume_ml was 0, using requested_ml=${actualVolumeMl} as fallback`);
  }

  const actualCost = calculateCost(actualVolumeMl);
  const refundAmount = Math.max(0, (session.reserved_cost_rwf || 0) - actualCost);

  await deductBalance(session.card_id, actualCost);

  const { data: completed, error: completeError } = await supabase
    .from('water_sessions')
    .update({
      status: SESSION_STATUS.COMPLETED,
      cost_rwf: actualCost,
      ended_at: new Date().toISOString(),
      refund_rwf: refundAmount,
    })
    .eq('id', sessionId)
    .select()
    .single();

  if (completeError) throw new Error(completeError.message);

  // Update cache with final data then evict (session is done)
  updateCachedSession(sessionId, {
    status: SESSION_STATUS.COMPLETED,
    cost_rwf: actualCost,
    volume_ml: actualVolumeMl,
    ended_at: completed.ended_at,
  });
  // Keep in cache briefly so the frontend can read the final state, then evict
  setTimeout(() => evictSession(sessionId), 30_000);

  await updateDailyUsage(session.user_id, session.volume_ml, actualCost);

  const { data: card } = await supabase.from('cards').select('balance_rwf').eq('id', session.card_id).single();
  const newBalance = card?.balance_rwf ?? 0;

  // Send dispensing receipt email (non-blocking)
  if (session.user_id) {
    (async () => {
      try {
        const { data: profile } = await supabase
          .from('profiles').select('full_name').eq('user_id', session.user_id).single();
        const { data: authUser } = await supabase.auth.admin.getUserById(session.user_id);
        const email = authUser?.user?.email;
        if (email) {
          await sendEmail({
            to:      email,
            toName:  profile?.full_name,
            subject: `💧 Water receipt — ${(actualVolumeMl / 1000).toFixed(2)} L · ${actualCost.toLocaleString()} RWF`,
            html:    buildDispenseEmail({
              userName:         profile?.full_name,
              volumeL:          actualVolumeMl / 1000,
              costRwf:          actualCost,
              remainingBalance: newBalance,
              sessionId:        sessionId,
            }),
          });
        }
      } catch (e) { console.warn('[Email] Dispense email failed:', e.message); }
    })();
  }

  // Notify customer if balance is low
  if (newBalance < 500) {
    await createSystemNotification({
      userId: session.user_id,
      type:   'low_balance',
      title:  'Low card balance',
      body:   `Your balance is ${newBalance.toLocaleString()} RWF. Please recharge to continue using water services.`,
    });
  }

  // Notify admins: session complete
  notifyAdmins({
    type:  'system',
    title: `💧 Water dispensed — ${(actualVolumeMl / 1000).toFixed(2)} L`,
    body:  `Cost: ${actualCost.toLocaleString()} RWF | Remaining balance: ${newBalance.toLocaleString()} RWF`,
  }).catch(() => {});

  return { session: completed, actualCost, newBalance };
}

export async function getUserSessions(userId, limit = 20) {
  const { data, error } = await supabase
    .from('water_sessions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data;
}

export async function getAllTransactions(limit = 100, offset = 0) {
  const { data: sessions, error: sessionsError } = await supabase
    .from('water_sessions')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (sessionsError) throw new Error(sessionsError.message);

  const userIds = [...new Set((sessions || []).map((s) => s.user_id).filter(Boolean))];
  const profileMap = new Map();

  if (userIds.length) {
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('user_id, full_name, email, phone')
      .in('user_id', userIds);

    if (profilesError) throw new Error(profilesError.message);

    for (const profile of profiles || []) {
      profileMap.set(profile.user_id, profile);
    }
  }

  return (sessions || []).map((session) => ({
    ...session,
    customer_name: profileMap.get(session.user_id)?.full_name || 'Unknown',
    customer_email: profileMap.get(session.user_id)?.email || '-',
    customer_phone: profileMap.get(session.user_id)?.phone || '-',
  }));
}
