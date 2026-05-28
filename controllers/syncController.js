import { processBatchSync, getPendingSync } from '../services/syncService.js';

export async function batchSync(req, res, next) {
  try {
    const { device_id, events } = req.body;
    if (!device_id || !Array.isArray(events)) {
      return res.status(400).json({ success: false, error: 'device_id and events array required' });
    }
    const result = await processBatchSync(device_id, events);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

export async function pendingSync(req, res, next) {
  try {
    const pending = await getPendingSync(req.params.deviceId);
    res.json({ success: true, pending });
  } catch (err) {
    next(err);
  }
}
