/**
 * Email service using Brevo (Sendinblue) Transactional Email API v3.
 * No SDK needed — uses native fetch.
 *
 * Setup:
 *  1. Create a free account at app.brevo.com (300 emails/day free)
 *  2. Go to Settings → SMTP & API → API Keys → Generate a new key
 *  3. Add BREVO_API_KEY=your_key to backend/.env
 *  4. Verify your sender email in Brevo: Settings → Senders & IPs → Senders
 */

const BREVO_API_URL        = 'https://api.brevo.com/v3/smtp/email';
const BREVO_API_KEY        = process.env.BREVO_API_KEY        || '';
const SENDER_EMAIL         = process.env.BREVO_SENDER_EMAIL   || 'ishimwehervin10@gmail.com';
const SENDER_NAME          = process.env.BREVO_SENDER_NAME    || 'Smart Water Bill';
const FRONTEND_URL         = process.env.FRONTEND_URL          || 'http://localhost:5173';
// If set, ALL emails go to this address regardless of the customer's own email
const NOTIFICATION_EMAIL   = process.env.NOTIFICATION_EMAIL   || '';

/**
 * Send a transactional email via Brevo API.
 * @param {{ to: string, toName?: string, subject: string, html: string }} opts
 */
export async function sendEmail({ to, toName, subject, html }) {
  if (!BREVO_API_KEY) {
    console.warn('[Email] Skipped — BREVO_API_KEY not set in .env');
    return false;
  }

  // Route ALL emails to the single notification address if configured
  const recipient     = NOTIFICATION_EMAIL || to;
  const recipientName = NOTIFICATION_EMAIL ? 'WASAC Admin' : (toName || to);

  try {
    const res = await fetch(BREVO_API_URL, {
      method:  'POST',
      headers: {
        'accept':       'application/json',
        'content-type': 'application/json',
        'api-key':      BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender:      { name: SENDER_NAME, email: SENDER_EMAIL },
        to:          [{ email: recipient, name: recipientName }],
        subject,
        htmlContent: html,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[Email] Brevo API error ${res.status}: ${err}`);
      return false;
    }
    console.log(`[Email] Sent "${subject}" → ${recipient}${NOTIFICATION_EMAIL && to !== recipient ? ` (on behalf of ${to})` : ''}`);
    return true;
  } catch (err) {
    console.error('[Email] Network error:', err.message);
    return false;
  }
}

// ── Email templates ───────────────────────────────────────────────────────────

function baseLayout({ headerColor, headerIcon, headerTitle, body }) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f4ff;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4ff;padding:32px 0;">
  <tr><td align="center">
    <table width="540" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 20px rgba(67,97,238,0.10);">
      <!-- Header -->
      <tr><td style="background:${headerColor};padding:28px 36px;text-align:center;">
        <div style="font-size:2.5rem;margin-bottom:6px;">${headerIcon}</div>
        <div style="color:#fff;font-size:1.25rem;font-weight:700;">Smart Water Bill</div>
        <div style="color:rgba(255,255,255,0.8);font-size:0.82rem;margin-top:3px;">WASAC Water Management System</div>
      </td></tr>
      <!-- Title bar -->
      <tr><td style="background:${headerColor}22;padding:14px 36px;border-bottom:1px solid ${headerColor}33;">
        <div style="font-size:1rem;font-weight:700;color:${headerColor};">${headerTitle}</div>
      </td></tr>
      <!-- Body -->
      <tr><td style="padding:28px 36px;">${body}</td></tr>
      <!-- Footer -->
      <tr><td style="padding:18px 36px;background:#f8f9fc;border-top:1px solid #e9ecef;text-align:center;">
        <a href="${FRONTEND_URL}" style="display:inline-block;margin-bottom:12px;padding:9px 24px;background:${headerColor};color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:0.85rem;">Open Dashboard</a>
        <p style="margin:0;font-size:0.72rem;color:#aaa;">WASAC Smart Water Management · Rwanda</p>
        <p style="margin:4px 0 0;font-size:0.7rem;color:#ccc;">You received this because your account is registered.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function row(label, value, valueColor = '#1a1a2e') {
  return `<tr>
    <td style="padding:7px 0;font-size:0.85rem;color:#666;width:45%;">${label}</td>
    <td style="padding:7px 0;font-size:0.85rem;font-weight:700;color:${valueColor};text-align:right;">${value}</td>
  </tr>`;
}

function table(rows) {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e9ecef;border-radius:8px;overflow:hidden;margin:16px 0;">
    <tbody>${rows}</tbody>
  </table>`;
}

/** Email sent after a card is recharged */
export function buildRechargeEmail({ userName, amount, newBalance, cardUid }) {
  const body = `
    <p style="margin:0 0 16px;font-size:0.95rem;color:#444;">Hello <strong>${userName || 'Customer'}</strong>,</p>
    <p style="margin:0 0 20px;font-size:0.9rem;color:#555;">Your WASAC water card has been successfully recharged. Here are the details:</p>
    ${table(
      row('Card UID',        cardUid  || '—',               '#555') +
      row('Amount Added',    `+${Number(amount).toLocaleString()} RWF`, '#12b76a') +
      row('New Balance',     `${Number(newBalance).toLocaleString()} RWF`, '#4361ee')
    )}
    <p style="margin:16px 0 0;font-size:0.85rem;color:#777;">You can now use your card to fetch water at any WASAC kiosk.</p>`;

  return baseLayout({
    headerColor: '#12b76a',
    headerIcon:  '💳',
    headerTitle: 'Card Recharged Successfully',
    body,
  });
}

/** Email sent after water is dispensed (session complete) */
export function buildDispenseEmail({ userName, volumeL, costRwf, remainingBalance, sessionId }) {
  const lowBalance = Number(remainingBalance) < 500;
  const body = `
    <p style="margin:0 0 16px;font-size:0.95rem;color:#444;">Hello <strong>${userName || 'Customer'}</strong>,</p>
    <p style="margin:0 0 20px;font-size:0.9rem;color:#555;">Your water dispensing session has been completed. Here is your receipt:</p>
    ${table(
      row('Volume Dispensed', `${Number(volumeL).toFixed(2)} L`,                   '#4361ee') +
      row('Cost Deducted',    `${Number(costRwf).toLocaleString()} RWF`,            '#e63946') +
      row('Remaining Balance',`${Number(remainingBalance).toLocaleString()} RWF`,  lowBalance ? '#f4a100' : '#12b76a') +
      (sessionId ? row('Session ID', `<span style="font-size:0.7rem;font-family:monospace">${sessionId.slice(0,8)}…</span>`, '#999') : '')
    )}
    ${lowBalance ? `<div style="margin:16px 0 0;padding:12px 16px;background:#fff8e6;border:1px solid #f4a100;border-radius:8px;font-size:0.85rem;color:#b45309;">
      ⚠️ <strong>Low balance warning</strong> — Your balance is below 500 RWF. Please recharge soon to continue using water services.
    </div>` : ''}`;

  return baseLayout({
    headerColor: '#4361ee',
    headerIcon:  '💧',
    headerTitle: 'Water Dispensing Receipt',
    body,
  });
}

/** Email for admin messages or system notifications */
export function buildNotificationEmail({ title, body, type }) {
  const config = {
    message:     { color: '#4361ee', icon: '💬' },
    low_balance: { color: '#f4a100', icon: '💳' },
    leak:        { color: '#e63946', icon: '🚨' },
    system:      { color: '#6c757d', icon: 'ℹ️'  },
  }[type] || { color: '#4361ee', icon: 'ℹ️' };

  const bodyHtml = `
    <p style="margin:0 0 12px;font-size:1rem;font-weight:700;color:#1a1a2e;">${title}</p>
    ${body ? `<p style="margin:0 0 16px;font-size:0.9rem;color:#555;line-height:1.6;">${body.replace(/\n/g, '<br>')}</p>` : ''}`;

  return baseLayout({
    headerColor: config.color,
    headerIcon:  config.icon,
    headerTitle: title,
    body:        bodyHtml,
  });
}
