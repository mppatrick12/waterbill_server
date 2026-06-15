import * as waterService from '../services/waterService.js';

export async function identify(req, res, next) {
  try {
    const result = await waterService.identifyCard(req.params.uid);
    if (!result.found) return res.status(404).json({ success: false, error: 'Card not found' });
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

export async function authorize(req, res, next) {
  try {
    const { card_uid, requested_ml, meter_id, device_id } = req.body;
    if (!card_uid || !requested_ml) {
      return res.status(400).json({ success: false, error: 'card_uid and requested_ml required' });
    }
    const result = await waterService.authorizeWaterFetch({
      cardUid: card_uid,
      requestedMl: requested_ml,
      meterId: meter_id,
      deviceId: device_id,
    });

    if (result.success) {
      return res.status(200).json({ success: true, ...result });
    }

    // Map each failure reason to the most appropriate HTTP status code
    const statusMap = {
      SYSTEM_WATER_FETCH_DISABLED: 503,
      CARD_NOT_REGISTERED:         422,
      ACCOUNT_NOT_APPROVED:        403,
      INSUFFICIENT_BALANCE:        402,
      MINIMUM_BALANCE_REQUIRED:    402,
      INVALID_VOLUME_REQUEST:      400,
    };
    const httpStatus = statusMap[result.reason] || 422;
    return res.status(httpStatus).json({ success: false, error: result.reason, message: result.message, ...result });
  } catch (err) {
    if (err.message === 'CARD_NOT_FOUND')   return res.status(404).json({ success: false, error: 'CARD_NOT_FOUND',   message: 'Card not found. Make sure your card is registered.' });
    if (err.message === 'CARD_INACTIVE')    return res.status(403).json({ success: false, error: 'CARD_INACTIVE',    message: 'Your card is inactive. Contact WASAC support.' });
    next(err);
  }
}

export async function flowTick(req, res, next) {
  try {
    const result = await waterService.recordFlowTick(req.body);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

export async function complete(req, res, next) {
  try {
    const result = await waterService.completeWaterFetch(req.body.session_id || req.params.sessionId);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

/** Send a start or stop command to the device for a given session.
 *  POST /water/session/:sessionId/command  { action: 'start_pump' | 'stop_pump' } */
export async function sendSessionCommand(req, res, next) {
  try {
    const { sessionId } = req.params;
    const { action } = req.body;
    if (!['start_pump', 'stop_pump'].includes(action)) {
      return res.status(400).json({ success: false, error: 'action must be start_pump or stop_pump' });
    }

    const { getCachedSession, updateCachedSession: syncCache } = await import('../services/sessionCache.js');
    const { supabase } = await import('../config/supabase.js');
    let session = getCachedSession(sessionId);

    // If device_id is missing from cache, do a fresh DB fetch — it may have been
    // assigned when the card was tapped at the kiosk after the session was created.
    if (!session || !session.device_id) {
      const { data, error } = await supabase
        .from('water_sessions')
        .select('id, device_id, user_id, status, requested_ml, card_tapped_at')
        .eq('id', sessionId)
        .single();
      if (error || !data) return res.status(404).json({ success: false, error: 'Session not found' });
      if (data.device_id && session) syncCache(sessionId, { device_id: data.device_id });
      session = session ? { ...session, ...data } : data;
    }

    if (req.profile.role === 'customer' && session.user_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    if (session.status === 'completed') {
      return res.status(400).json({ success: false, error: 'Session already completed' });
    }

    const { publishDeviceCommand } = await import('../services/mqttService.js');
    const deviceId = session.device_id;
    if (!deviceId) return res.status(422).json({ success: false, error: 'No device linked to session — tap your card at the kiosk first' });

    await publishDeviceCommand(deviceId, {
      action,
      session_id: sessionId,
      requested_ml: session.requested_ml || 0,
    });

    const now = new Date().toISOString();
    if (action === 'stop_pump') {
      syncCache(sessionId, { pump_stopped_at: now });
      supabase.from('water_sessions').update({ pump_stopped_at: now }).eq('id', sessionId).then(() => {}).catch(() => {});
    }
    if (action === 'start_pump') {
      syncCache(sessionId, { pump_started_at: now });
      supabase.from('water_sessions').update({ pump_started_at: now }).eq('id', sessionId).then(() => {}).catch(() => {});
    }

    res.json({ success: true, message: `${action} command sent to device ${deviceId}` });
  } catch (err) {
    next(err);
  }
}

export async function getSessionById(req, res, next) {
  try {
    const { sessionId } = req.params;
    const { getCachedSession } = await import('../services/sessionCache.js');

    // Try in-memory cache first — near-zero latency for active sessions
    const cached = getCachedSession(sessionId);
    if (cached) {
      if (req.profile.role === 'customer' && cached.user_id !== req.user.id) {
        return res.status(403).json({ success: false, error: 'Access denied' });
      }
      return res.json({ success: true, session: cached, _source: 'cache' });
    }

    // Fall back to Supabase (cold start or after eviction)
    const { supabase } = await import('../config/supabase.js');
    const { data: session, error } = await supabase
      .from('water_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();
    if (error || !session) return res.status(404).json({ success: false, error: 'Session not found' });
    if (req.profile.role === 'customer' && session.user_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    // Warm up the cache for subsequent polls
    if (session.status === 'active') {
      const { cacheSession: warmCache } = await import('../services/sessionCache.js');
      warmCache(session);
    }
    res.json({ success: true, session, _source: 'db' });
  } catch (err) {
    next(err);
  }
}

export async function getSessions(req, res, next) {
  try {
    const userId = req.params.userId || req.user.id;
    if (req.profile.role === 'customer' && userId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    const sessions = await waterService.getUserSessions(userId);
    res.json({ success: true, sessions });
  } catch (err) {
    next(err);
  }
}

export async function getAllTransactions(req, res, next) {
  try {
    const { role } = req.profile;
    if (role !== 'admin' && role !== 'wasac_manager') {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    const transactions = await waterService.getAllTransactions(limit, offset);
    res.json({ success: true, transactions });
  } catch (err) {
    next(err);
  }
}
