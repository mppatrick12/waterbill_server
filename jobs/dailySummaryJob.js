import cron from 'node-cron';
import { supabase } from '../config/supabase.js';
import { sendDailyUsageSummary } from '../services/brevoEmailService.js';

export function startDailySummaryJob() {
  cron.schedule('0 20 * * *', async () => {
    console.log('[Cron] Running daily usage summary...');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];

    const { data: usageRows } = await supabase
      .from('daily_usage')
      .select('user_id, total_ml, total_rwf')
      .eq('date', dateStr);

    const userIds = Array.from(new Set((usageRows || []).map((row) => row.user_id)));
    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, email, full_name')
      .in('user_id', userIds);

    const profileMap = (profiles || []).reduce((acc, profile) => {
      acc[profile.user_id] = profile;
      return acc;
    }, {});

    for (const row of usageRows || []) {
      const profile = profileMap[row.user_id];
      if (profile?.email) {
        try {
          await sendDailyUsageSummary(
            profile.email,
            profile.full_name,
            row.total_ml,
            row.total_rwf,
            dateStr
          );
        } catch (e) {
          console.error(`Daily summary failed for ${row.user_id}:`, e.message);
        }
      }
    }
    console.log(`[Cron] Sent ${(usageRows || []).length} daily summaries`);
  });
  console.log('Daily summary cron scheduled (20:00 daily)');
}
