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
    const status = result.success ? 200 : 403;
    res.status(status).json({ success: result.success, ...result });
  } catch (err) {
    if (err.message === 'CARD_NOT_FOUND') return res.status(404).json({ success: false, error: err.message });
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
