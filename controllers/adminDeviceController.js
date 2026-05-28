import { createDevice, listDevices, setDeviceStatus } from '../services/deviceService.js';
import { publishDeviceCommand } from '../services/mqttService.js';
import { isMqttConnected } from '../services/mqttService.js';

export async function listAdminDevices(req, res, next) {
  try {
    const devices = await listDevices();
    res.json({ success: true, devices });
  } catch (err) {
    next(err);
  }
}

export async function createAdminDevice(req, res, next) {
  try {
    const { esp32_device_id, device_label, location, flow_rate_threshold } = req.body;
    if (!esp32_device_id) {
      return res.status(400).json({ success: false, error: 'esp32_device_id required' });
    }

    const device = await createDevice({
      esp32_device_id,
      device_label,
      location,
      flow_rate_threshold: Number(flow_rate_threshold) || 50,
    });

    res.status(201).json({ success: true, device });
  } catch (err) {
    next(err);
  }
}

export async function setAdminDeviceStatus(req, res, next) {
  try {
    const { deviceId } = req.params;
    const { status } = req.body;
    if (!['online', 'offline'].includes(status)) {
      return res.status(400).json({ success: false, error: 'status must be online or offline' });
    }

    const device = await setDeviceStatus(deviceId, status);
    res.json({ success: true, device });
  } catch (err) {
    next(err);
  }
}

export async function registerAdminDevice(req, res, next) {
  try {
    const { deviceId } = req.params;
    await publishDeviceCommand(deviceId, 'register');
    res.json({ success: true, message: 'Register command sent.' });
  } catch (err) {
    next(err);
  }
}

export async function getAdminMqttStatus(req, res, next) {
  try {
    const connected = isMqttConnected();
    res.json({ success: true, connected });
  } catch (err) {
    next(err);
  }
}