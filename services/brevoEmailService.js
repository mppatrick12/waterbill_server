import { brevoConfig } from '../config/brevo.js';

async function sendEmail({ to, subject, htmlContent }) {
  if (!brevoConfig.apiKey) {
    console.log(`[Brevo Mock] To: ${to} | Subject: ${subject}`);
    return { success: true, mock: true };
  }

  const response = await fetch(brevoConfig.apiUrl, {
    method: 'POST',
    headers: {
      'api-key': brevoConfig.apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { name: brevoConfig.senderName, email: brevoConfig.senderEmail },
      to: [{ email: to }],
      subject,
      htmlContent,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Brevo API error: ${err}`);
  }
  return response.json();
}

export async function sendLowBalanceAlert(email, name, balance, userId) {
  return sendEmail({
    to: email,
    subject: 'Low Balance Warning - WASAC Water',
    htmlContent: `
      <h2>Low Balance Alert</h2>
      <p>Dear ${name},</p>
      <p>Your water card balance is low: <strong>${balance} RWF</strong>.</p>
      <p>User ID: ${userId}</p>
      <p>Please recharge soon to avoid service interruption.</p>
      <p>— WASAC Smart Water System</p>
    `,
  });
}

export async function sendRechargeSuccess(email, name, amount, newBalance) {
  return sendEmail({
    to: email,
    subject: 'Recharge Successful - WASAC Water',
    htmlContent: `
      <h2>Recharge Successful</h2>
      <p>Dear ${name},</p>
      <p>Your account has been credited with <strong>${amount} RWF</strong>.</p>
      <p>New balance: <strong>${newBalance} RWF</strong></p>
      <p>— WASAC Smart Water System</p>
    `,
  });
}

export async function sendWaterDisconnected(email, name, reason) {
  return sendEmail({
    to: email,
    subject: 'Water Service Disconnected - WASAC Water',
    htmlContent: `
      <h2>Service Disconnected</h2>
      <p>Dear ${name},</p>
      <p>Your water service has been disconnected.</p>
      <p>Reason: ${reason}</p>
      <p>Please recharge your card to restore service.</p>
      <p>— WASAC Smart Water System</p>
    `,
  });
}

export async function sendDailyUsageSummary(email, name, usageMl, costRwf, date) {
  return sendEmail({
    to: email,
    subject: `Daily Usage Summary - ${date}`,
    htmlContent: `
      <h2>Daily Usage Summary</h2>
      <p>Dear ${name},</p>
      <p>Date: <strong>${date}</strong></p>
      <p>Water used: <strong>${(usageMl / 1000).toFixed(2)} L</strong> (${usageMl} ml)</p>
      <p>Cost: <strong>${costRwf} RWF</strong></p>
      <p>— WASAC Smart Water System</p>
    `,
  });
}

export async function sendLeakAlert(email, name, userId, location, reason) {
  return sendEmail({
    to: email,
    subject: 'URGENT: Possible Leakage Detected - WASAC Water',
    htmlContent: `
      <h2 style="color:red;">Leak Alert</h2>
      <p>Dear ${name},</p>
      <p><strong>Possible leakage detected at User ID ${userId}.</strong></p>
      <p>Location: ${location || 'Unknown'}</p>
      <p>Reason: ${reason}</p>
      <p>Please inspect your connection immediately.</p>
      <p>— WASAC Smart Water System</p>
    `,
  });
}
