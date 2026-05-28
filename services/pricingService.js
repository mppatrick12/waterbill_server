import { pricingConfig } from '../config/brevo.js';

export function calculateCost(volumeMl) {
  const ml = Math.max(0, Math.round(volumeMl));
  return ml * pricingConfig.pricePerMl;
}

export function mlFromRwf(amountRwf) {
  if (pricingConfig.pricePerMl <= 0) return 0;
  return Math.floor(amountRwf / pricingConfig.pricePerMl);
}

export function canAfford(balanceRwf, volumeMl) {
  return balanceRwf >= calculateCost(volumeMl);
}

export function getPricingInfo() {
  return {
    pricePerMl: pricingConfig.pricePerMl,
    pricePerLiter: pricingConfig.pricePerLiter,
    lowBalanceThreshold: pricingConfig.lowBalanceThreshold,
    minStartingBalance: pricingConfig.minStartingBalance,
    currency: 'RWF',
  };
}
