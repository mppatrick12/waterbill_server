import { supabase } from '../config/supabase.js';
import { leakConfig } from '../config/brevo.js';
import { ALERT_SEVERITY, SESSION_STATUS } from '../config/constants.js';
import { sendLeakAlert } from './brevoEmailService.js';

export async function checkLeakConditions(session, flowTick) {
  const alerts = [];
  const now = Date.now();
  const startedAt = new Date(session.started_at).getTime();
  const durationSeconds = (now - startedAt) / 1000;

  if (durationSeconds > leakConfig.maxContinuousSeconds) {
    alerts.push({
      reason: `Continuous water flow for ${Math.round(durationSeconds)}s (max ${leakConfig.maxContinuousSeconds}s)`,
      severity: ALERT_SEVERITY.HIGH,
    });
  }

  if (flowTick?.flow_rate_ml_per_sec > leakConfig.abnormalFlowMlPerSec) {
    alerts.push({
      reason: `Abnormal flow rate: ${flowTick.flow_rate_ml_per_sec} ml/s (max ${leakConfig.abnormalFlowMlPerSec} ml/s)`,
      severity: ALERT_SEVERITY.CRITICAL,
    });
  }

  return alerts;
}

export async function createLeakAlert({ userId, meterId, sessionId, reason, severity }) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, email')
    .eq('user_id', userId)
    .single();

  const { data: meter } = meterId
    ? await supabase.from('meters').select('location').eq('id', meterId).single()
    : { data: null };

  const message = `Possible leakage detected at User ID ${userId?.slice(0, 8) || userId}.`;

  const { data: alert, error } = await supabase
    .from('leak_alerts')
    .insert({
      user_id: userId,
      meter_id: meterId,
      session_id: sessionId,
      reason,
      severity,
      message,
      resolved: false,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  if (sessionId) {
    await supabase
      .from('water_sessions')
      .update({ status: SESSION_STATUS.LEAK_SUSPECTED })
      .eq('id', sessionId);
  }

  if (profile?.email) {
    try {
      await sendLeakAlert(profile.email, profile.full_name, userId, meter?.location, reason);
    } catch (e) {
      console.error('Leak email failed:', e.message);
    }
  }

  return { alert, message };
}

export async function processFlowTick(session, flowTick) {
  const leakChecks = await checkLeakConditions(session, flowTick);
  if (leakChecks.length === 0) return null;

  const worst = leakChecks.sort((a, b) => {
    const order = { critical: 4, high: 3, medium: 2, low: 1 };
    return (order[b.severity] || 0) - (order[a.severity] || 0);
  })[0];

  return createLeakAlert({
    userId: session.user_id,
    meterId: session.meter_id,
    sessionId: session.id,
    reason: worst.reason,
    severity: worst.severity,
  });
}

export async function getLeakAlerts(filters = {}) {
  let query = supabase
    .from('leak_alerts')
    .select('*')
    .order('created_at', { ascending: false });

  if (filters.userId) query = query.eq('user_id', filters.userId);
  if (filters.resolved !== undefined) query = query.eq('resolved', filters.resolved);

  const { data, error } = await query.limit(filters.limit || 50);
  if (error) throw new Error(error.message);
  return data;
}

export async function resolveLeakAlert(alertId) {
  const { data, error } = await supabase
    .from('leak_alerts')
    .update({ resolved: true, resolved_at: new Date().toISOString() })
    .eq('id', alertId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}
