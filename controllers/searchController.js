import { supabase } from '../config/supabase.js';

export async function search(req, res, next) {
  try {
    const q = (req.query.q || '').trim();
    if (!q || q.length < 2) return res.json({ success: true, results: [] });

    const { role, user_id } = req.profile;
    const isAdmin = role === 'admin' || role === 'wasac_manager';
    const like    = `%${q}%`;
    const results = [];

    /* ── Sessions ─────────────────────────────────────────── */
    const sessionQuery = supabase
      .from('water_sessions')
      .select('id, status, volume_ml, cost_rwf, created_at, device_id')
      .or(`status.ilike.${like},device_id.ilike.${like}`)
      .order('created_at', { ascending: false })
      .limit(5);

    if (!isAdmin) sessionQuery.eq('user_id', req.user.id);

    const { data: sessions } = await sessionQuery;
    for (const s of sessions || []) {
      results.push({
        type:    'session',
        icon:    '💧',
        title:   `Session — ${s.status}`,
        sub:     `${((s.volume_ml || 0) / 1000).toFixed(1)} L · ${s.device_id || ''}`,
        time:    s.created_at,
      });
    }

    /* ── Users (admin only) ───────────────────────────────── */
    if (isAdmin) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('full_name, email, role, account_status')
        .or(`full_name.ilike.${like},email.ilike.${like}`)
        .limit(5);

      for (const p of profiles || []) {
        results.push({
          type:  'user',
          icon:  '👤',
          title: p.full_name || p.email,
          sub:   `${p.email} · ${p.role} · ${p.account_status}`,
          time:  null,
        });
      }
    }

    /* ── Cards ─────────────────────────────────────────────── */
    const cardQuery = supabase
      .from('cards')
      .select('card_uid, rfid_uid, balance_rwf, is_active')
      .or(`card_uid.ilike.${like},rfid_uid.ilike.${like}`)
      .limit(5);

    if (!isAdmin) cardQuery.eq('user_id', req.user.id);

    const { data: cards } = await cardQuery;
    for (const c of cards || []) {
      results.push({
        type:  'card',
        icon:  '💳',
        title: `Card ${c.card_uid}`,
        sub:   `Balance: ${c.balance_rwf} RWF · ${c.is_active ? 'Active' : 'Inactive'}`,
        time:  null,
      });
    }

    res.json({ success: true, results });
  } catch (err) { next(err); }
}
