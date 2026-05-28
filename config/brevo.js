import dotenv from 'dotenv';

dotenv.config();

export const brevoConfig = {
  apiKey: process.env.BREVO_API_KEY,
  senderEmail: process.env.BREVO_SENDER_EMAIL || 'noreply@wasac-water.rw',
  senderName: process.env.BREVO_SENDER_NAME || 'WASAC Water',
  apiUrl: 'https://api.brevo.com/v3/smtp/email',
};

const pricePerLiter = parseFloat(process.env.PRICE_PER_LITER || process.env.PRICE_PER_ML || '20');

export const pricingConfig = {
  pricePerMl: pricePerLiter / 1000,
  pricePerLiter,
  lowBalanceThreshold: parseFloat(process.env.LOW_BALANCE_THRESHOLD) || 500,
  minStartingBalance: parseFloat(process.env.MIN_STARTING_BALANCE_RWF) || 100,
};

export const leakConfig = {
  maxContinuousSeconds: parseInt(process.env.LEAK_MAX_CONTINUOUS_SECONDS) || 300,
  abnormalFlowMlPerSec: parseFloat(process.env.LEAK_ABNORMAL_FLOW_ML_PER_SEC) || 50,
};
