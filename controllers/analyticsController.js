import * as analytics from '../services/analyticsService.js';
import { predictConsumption } from '../services/predictionService.js';

export async function overview(req, res, next) {
  try {
    const stats = await analytics.getOverviewStats();
    res.json({ success: true, stats });
  } catch (err) {
    next(err);
  }
}

export async function usageGraph(req, res, next) {
  try {
    const data = await analytics.getUsageGraph(req.query.period || 'monthly');
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function topConsumers(req, res, next) {
  try {
    const data = await analytics.getTopConsumers(parseInt(req.query.limit) || 10);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function waterLoss(req, res, next) {
  try {
    const report = await analytics.getWaterLossReport();
    res.json({ success: true, report });
  } catch (err) {
    next(err);
  }
}

export async function predict(req, res, next) {
  try {
    const userId = req.params.userId || req.user.id;
    if (req.profile.role === 'customer' && userId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    const prediction = await predictConsumption(userId);
    res.json({ success: true, prediction });
  } catch (err) {
    next(err);
  }
}

export async function myUsage(req, res, next) {
  try {
    const data = await analytics.getUserDailyUsage(req.user.id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}
