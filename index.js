import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import authRoutes from './routes/authRoutes.js';
import cardRoutes from './routes/cardRoutes.js';
import waterRoutes from './routes/waterRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import alertRoutes from './routes/alertRoutes.js';
import reportRoutes from './routes/reportRoutes.js';
import syncRoutes from './routes/syncRoutes.js';
import userRoutes from './routes/userRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import { startDeviceMqttListener } from './services/mqttService.js';
import { applyAllMigrationsBestEffort } from './services/migrationService.js';


import { errorHandler, notFound } from './middleware/errorHandler.js';
import { getPricingInfo } from './services/pricingService.js';
import { startDailySummaryJob } from './jobs/dailySummaryJob.js';
import { corsOptions, corsPreflightMiddleware, getAllowedOrigins } from './config/cors.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(corsPreflightMiddleware);
app.use(cors(corsOptions()));
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ success: true, message: 'Smart Water Bill API', health: '/api/health' });
});

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Smart Water Bill API',
    version: '1.0.0',
    pricing: getPricingInfo(),
    corsOrigins: getAllowedOrigins(),
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/cards', cardRoutes);
app.use('/api/water', waterRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);

app.use(notFound);
app.use(errorHandler);

async function bootstrap() {
  await applyAllMigrationsBestEffort();
  startDailySummaryJob();
  startDeviceMqttListener();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Smart Water Bill API on port ${PORT}`);
    console.log(`CORS origins: ${getAllowedOrigins().join(', ')}`);
    console.log(
      `Pricing: ${getPricingInfo().pricePerLiter} RWF per liter (${getPricingInfo().pricePerMl} RWF per ml)`
    );
  });
}

bootstrap().catch((error) => {
  console.error('[Bootstrap] Failed to start server:', error);
  process.exit(1);
});

export default app;
