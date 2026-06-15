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
import notificationRoutes from './routes/notificationRoutes.js';
import searchRoutes from './routes/searchRoutes.js';
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
app.use('/api/notifications', notificationRoutes);
app.use('/api/search', searchRoutes);

app.use(notFound);
app.use(errorHandler);

/** Ping Supabase DB on startup so the free-tier instance wakes up before real requests arrive.
 *  Also ensures required columns exist (added in later migrations). */
async function wakeUpSupabase(maxAttempts = 5) {
  const { supabase } = await import('./config/supabase.js');
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      const { error } = await supabase.from('profiles').select('user_id').limit(1);
      if (!error) {
        console.log(`[Startup] Supabase is awake (attempt ${i}).`);
        // Ensure pump_started_at / pump_stopped_at columns exist (ALTER TABLE via RPC if available)
        await ensureSessionColumns(supabase).catch(() => {});
        return;
      }
      console.warn(`[Startup] Supabase not ready yet (attempt ${i}/${maxAttempts}): ${error.message}`);
    } catch (err) {
      console.warn(`[Startup] Supabase ping threw (attempt ${i}/${maxAttempts}): ${err.message}`);
    }
    if (i < maxAttempts) await new Promise(r => setTimeout(r, 3000 * i));
  }
  console.warn('[Startup] Supabase still not responding after all attempts — API will retry per-request.');
}

/** Try to add missing columns to water_sessions (idempotent). */
async function ensureSessionColumns(supabase) {
  const columns = [
    { name: 'pump_started_at', type: 'TIMESTAMPTZ' },
    { name: 'pump_stopped_at', type: 'TIMESTAMPTZ' },
    { name: 'card_tapped_at',  type: 'TIMESTAMPTZ' },
  ];
  for (const col of columns) {
    try {
      const { error } = await supabase.from('water_sessions').select(col.name).limit(1);
      if (error && error.message?.includes(col.name)) {
        // Try to add the column via Supabase's rpc exec_sql (only available with service role)
        const { error: alterErr } = await supabase.rpc('exec_sql', {
          sql: `ALTER TABLE water_sessions ADD COLUMN IF NOT EXISTS ${col.name} ${col.type};`,
        }).catch(() => ({ error: { message: 'rpc not available' } }));
        if (alterErr) {
          console.warn(`[Startup] water_sessions.${col.name} missing. Please run: ALTER TABLE water_sessions ADD COLUMN IF NOT EXISTS ${col.name} ${col.type};`);
        } else {
          console.log(`[Startup] Added column water_sessions.${col.name}`);
        }
      }
    } catch (_) {}
  }
}

async function bootstrap() {
  // Start server immediately so health checks work, then wake Supabase in background
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Smart Water Bill API on port ${PORT}`);
    console.log(`CORS origins: ${getAllowedOrigins().join(', ')}`);
    console.log(
      `Pricing: ${getPricingInfo().pricePerLiter} RWF per liter (${getPricingInfo().pricePerMl} RWF per ml)`
    );
  });

  // Run these after server is listening
  await applyAllMigrationsBestEffort().catch(() => {});
  wakeUpSupabase().catch(() => {});   // non-blocking
  startDailySummaryJob();
  startDeviceMqttListener();
}

bootstrap().catch((error) => {
  console.error('[Bootstrap] Failed to start server:', error);
  process.exit(1);
});

export default app;
