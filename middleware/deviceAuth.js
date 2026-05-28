import { AppError } from './errorHandler.js';

export function deviceAuth(req, res, next) {
  const deviceKey = req.headers['x-device-key'];
  const expectedKey = process.env.ESP32_DEVICE_KEY || 'esp32-dev-key-change-me';

  if (!deviceKey || deviceKey !== expectedKey) {
    return res.status(401).json({ success: false, error: 'Invalid device key' });
  }
  next();
}
