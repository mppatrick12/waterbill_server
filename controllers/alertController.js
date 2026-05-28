import { getLeakAlerts, resolveLeakAlert } from '../services/leakDetectionService.js';

export async function listAlerts(req, res, next) {
  try {
    const filters = {
      resolved: req.query.resolved === 'true' ? true : req.query.resolved === 'false' ? false : undefined,
      userId: req.profile.role === 'customer' ? req.user.id : req.query.user_id,
      limit: parseInt(req.query.limit) || 50,
    };
    const alerts = await getLeakAlerts(filters);
    res.json({ success: true, alerts });
  } catch (err) {
    next(err);
  }
}

export async function resolveAlert(req, res, next) {
  try {
    const alert = await resolveLeakAlert(req.params.id);
    res.json({ success: true, alert });
  } catch (err) {
    next(err);
  }
}
