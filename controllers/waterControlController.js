import * as systemControlService from '../services/systemControlService.js';

export async function getWaterFetchControl(req, res, next) {
  try {
    const enabled = await systemControlService.getWaterFetchEnabled();
    res.json({ success: true, water_fetch_enabled: enabled });
  } catch (err) {
    next(err);
  }
}

export async function setWaterFetchControl(req, res, next) {
  try {
    const { water_fetch_enabled } = req.body;
    if (typeof water_fetch_enabled !== 'boolean') {
      return res.status(400).json({ success: false, error: 'water_fetch_enabled boolean required' });
    }
    await systemControlService.setWaterFetchEnabled(water_fetch_enabled);
    res.json({ success: true, water_fetch_enabled });
  } catch (err) {
    next(err);
  }
}

