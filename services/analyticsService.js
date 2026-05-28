import { supabase } from '../config/supabase.js';

export async function updateDailyUsage(userId, volumeMl, costRwf) {
  const today = new Date().toISOString().split('T')[0];

  const { data: existing } = await supabase
    .from('daily_usage')
    .select('*')
    .eq('user_id', userId)
    .eq('date', today)
    .single();

  if (existing) {
    await supabase
      .from('daily_usage')
      .update({
        total_ml: existing.total_ml + volumeMl,
        total_rwf: existing.total_rwf + costRwf,
      })
      .eq('id', existing.id);
  } else {
    await supabase.from('daily_usage').insert({
      user_id: userId,
      date: today,
      total_ml: volumeMl,
      total_rwf: costRwf,
    });
  }
}

export async function getOverviewStats() {
  const [recharges, sessions, profiles, leaks] = await Promise.all([
    supabase.from('recharges').select('amount_rwf'),
    supabase.from('water_sessions').select('volume_ml, cost_rwf, status').eq('status', 'completed'),
    supabase.from('profiles').select('id, role'),
    supabase.from('leak_alerts').select('id, resolved').eq('resolved', false),
  ]);

  const totalRevenue = (recharges.data || []).reduce((s, r) => s + (r.amount_rwf || 0), 0);
  const totalWaterMl = (sessions.data || []).reduce((s, r) => s + (r.volume_ml || 0), 0);
  const totalBilled = (sessions.data || []).reduce((s, r) => s + (r.cost_rwf || 0), 0);
  const activeUsers = (profiles.data || []).filter((p) => p.role === 'customer').length;
  const activeLeaks = (leaks.data || []).length;

  return {
    totalRevenue,
    totalWaterMl,
    totalWaterLiters: (totalWaterMl / 1000).toFixed(2),
    totalBilled,
    activeUsers,
    activeLeaks,
    totalCustomers: activeUsers,
  };
}

export async function getUsageGraph(period = 'monthly') {
  const days = period === 'daily' ? 7 : 30;
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data, error } = await supabase
    .from('daily_usage')
    .select('date, total_ml, total_rwf')
    .gte('date', since.toISOString().split('T')[0])
    .order('date', { ascending: true });

  if (error) throw new Error(error.message);

  const grouped = {};
  for (const row of data || []) {
    if (!grouped[row.date]) grouped[row.date] = { date: row.date, total_ml: 0, total_rwf: 0 };
    grouped[row.date].total_ml += row.total_ml;
    grouped[row.date].total_rwf += row.total_rwf;
  }
  return Object.values(grouped);
}

export async function getTopConsumers(limit = 10) {
  const { data, error } = await supabase
    .from('water_sessions')
    .select('user_id, volume_ml')
    .eq('status', 'completed');

  if (error) throw new Error(error.message);

  const byUser = {};
  for (const row of data || []) {
    if (!byUser[row.user_id]) {
      byUser[row.user_id] = {
        user_id: row.user_id,
        total_ml: 0,
      };
    }
    byUser[row.user_id].total_ml += row.volume_ml || 0;
  }

  const userIds = Object.keys(byUser);
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, full_name')
      .in('user_id', userIds);

    for (const profile of profiles || []) {
      if (byUser[profile.user_id]) {
        byUser[profile.user_id].full_name = profile.full_name;
      }
    }
  }

  return Object.values(byUser)
    .map((item) => ({
      ...item,
      full_name: item.full_name || 'Unknown',
    }))
    .sort((a, b) => b.total_ml - a.total_ml)
    .slice(0, limit);
}

export async function getWaterLossReport() {
  const { data: leakSessions } = await supabase
    .from('water_sessions')
    .select('volume_ml, cost_rwf')
    .eq('status', 'leak_suspected');

  const { data: alerts } = await supabase
    .from('leak_alerts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);

  const lostMl = (leakSessions || []).reduce((s, r) => s + (r.volume_ml || 0), 0);
  const lostRevenue = (leakSessions || []).reduce((s, r) => s + (r.cost_rwf || 0), 0);

  return {
    estimatedLossMl: lostMl,
    estimatedLossLiters: (lostMl / 1000).toFixed(2),
    estimatedRevenueLoss: lostRevenue,
    recentAlerts: alerts || [],
    alertCount: (alerts || []).length,
  };
}

export async function getUserDailyUsage(userId, days = 30) {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data, error } = await supabase
    .from('daily_usage')
    .select('*')
    .eq('user_id', userId)
    .gte('date', since.toISOString().split('T')[0])
    .order('date', { ascending: true });

  if (error) throw new Error(error.message);
  return data || [];
}
