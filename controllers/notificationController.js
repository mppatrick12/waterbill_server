import { supabase } from '../config/supabase.js';
import { sendEmail, buildNotificationEmail } from '../services/emailService.js';

/* ── Helper: get user email from Supabase Auth ── */
async function getUserEmail(userId) {
  try {
    const { data } = await supabase.auth.admin.getUserById(userId);
    return data?.user?.email || null;
  } catch { return null; }
}

/* GET /notifications/my  — current user's notifications, newest first */
export async function getMyNotifications(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw new Error(error.message);
    res.json({ success: true, notifications: data || [] });
  } catch (err) { next(err); }
}

/* PATCH /notifications/:id/read  — mark one notification as read */
export async function markRead(req, res, next) {
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);

    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (err) { next(err); }
}

/* PATCH /notifications/read-all  — mark all as read for current user */
export async function markAllRead(req, res, next) {
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', req.user.id)
      .eq('is_read', false);

    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (err) { next(err); }
}

/* POST /notifications/send  — admin/manager sends a message to a user */
export async function sendNotification(req, res, next) {
  try {
    const { role } = req.profile;
    if (!['admin', 'wasac_manager'].includes(role)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const { user_id, title, body } = req.body;
    if (!user_id || !title) {
      return res.status(400).json({ success: false, error: 'user_id and title are required' });
    }

    const { data, error } = await supabase
      .from('notifications')
      .insert({
        user_id,
        sender_id: req.user.id,
        type: 'message',
        title: title.slice(0, 200),
        body:  body ? body.slice(0, 1000) : null,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);

    // Send email notification asynchronously (non-blocking)
    getUserEmail(user_id).then(email => {
      if (email) {
        sendEmail({
          to: email,
          subject: `📩 New message: ${title}`,
          html: buildNotificationEmail({ title, body, type: 'message' }),
        }).catch(() => {});
      }
    }).catch(() => {});

    res.status(201).json({ success: true, notification: data });
  } catch (err) { next(err); }
}

/* Internal helper — create a system notification for a specific user */
export async function createSystemNotification({ userId, type, title, body }) {
  try {
    await supabase.from('notifications').insert({ user_id: userId, type, title, body });

    // Send email for important notifications
    if (['low_balance', 'leak', 'message'].includes(type)) {
      getUserEmail(userId).then(email => {
        if (email) {
          sendEmail({
            to: email,
            subject: type === 'low_balance' ? `⚠️ Low balance alert: ${title}`
                   : type === 'leak'        ? `🚨 Leak alert: ${title}`
                   :                         `📩 ${title}`,
            html: buildNotificationEmail({ title, body, type }),
          }).catch(() => {});
        }
      }).catch(() => {});
    }
  } catch {
    // non-fatal
  }
}

/* Internal helper — create a notification for ALL admin users */
export async function notifyAdmins({ type, title, body }) {
  try {
    // Find all admin user IDs
    const { data: admins } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('role', 'admin');

    if (!admins || admins.length === 0) return;

    const rows = admins.map(a => ({ user_id: a.user_id, type, title, body }));
    await supabase.from('notifications').insert(rows);

    // Also send one email to the configured notification address
    sendEmail({
      to:      process.env.NOTIFICATION_EMAIL || process.env.BREVO_SENDER_EMAIL || '',
      subject: type === 'leak' ? `🚨 ${title}` : type === 'low_balance' ? `⚠️ ${title}` : `ℹ️ ${title}`,
      html:    buildNotificationEmail({ title, body, type }),
    }).catch(() => {});
  } catch {
    // non-fatal
  }
}
