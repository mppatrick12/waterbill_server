import { linearRegression, linearRegressionLine, standardDeviation, mean } from 'simple-statistics';
import { calculateCost } from './pricingService.js';
import { getUserDailyUsage } from './analyticsService.js';

export async function predictConsumption(userId) {
  const history = await getUserDailyUsage(userId, 60);

  if (history.length < 3) {
    const avgMl = history.length ? mean(history.map((h) => h.total_ml)) : 0;
    return {
      averageDailyMl: Math.round(avgMl),
      averageDailyLiters: (avgMl / 1000).toFixed(2),
      expectedMonthlyBill: Math.round(calculateCost(avgMl * 30)),
      expectedMonthlyMl: Math.round(avgMl * 30),
      trend: 'insufficient_data',
      isAbnormal: false,
      confidence: 'low',
      dataPoints: history.length,
    };
  }

  const points = history.map((h, i) => [i, h.total_ml]);
  const reg = linearRegression(points);
  const predict = linearRegressionLine(reg);
  const values = history.map((h) => h.total_ml);
  const avg = mean(values);
  const std = standardDeviation(values);
  const lastDay = history[history.length - 1];
  const isAbnormal = lastDay.total_ml > avg + 2 * std;

  const next30DaysMl = Array.from({ length: 30 }, (_, i) => predict(history.length + i))
    .reduce((s, v) => s + Math.max(0, v), 0);

  const trend = reg.m > 5 ? 'increasing' : reg.m < -5 ? 'decreasing' : 'stable';

  return {
    averageDailyMl: Math.round(avg),
    averageDailyLiters: (avg / 1000).toFixed(2),
    expectedMonthlyBill: Math.round(calculateCost(next30DaysMl)),
    expectedMonthlyMl: Math.round(next30DaysMl),
    lastDayMl: lastDay.total_ml,
    trend,
    isAbnormal,
    abnormalReason: isAbnormal
      ? `Usage on ${lastDay.date} (${lastDay.total_ml} ml) exceeds 2 standard deviations above average`
      : null,
    confidence: history.length >= 14 ? 'high' : 'medium',
    dataPoints: history.length,
    chartData: history.map((h) => ({
      date: h.date,
      ml: h.total_ml,
      liters: (h.total_ml / 1000).toFixed(2),
      cost: h.total_rwf,
    })),
  };
}
