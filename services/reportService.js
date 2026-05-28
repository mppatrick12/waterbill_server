import PDFDocument from 'pdfkit';
import { supabase } from '../config/supabase.js';
import { getPricingInfo } from './pricingService.js';
import { getUserDailyUsage } from './analyticsService.js';

function buildPdfBuffer(buildFn) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    buildFn(doc);
    doc.end();
  });
}

export async function generateMonthlyBill(userId, year, month) {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endMonth = month === 12 ? 1 : month + 1;
  const endYear = month === 12 ? year + 1 : year;
  const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;

  const [{ data: profile }, { data: sessions }, { data: recharges }] = await Promise.all([
    supabase.from('profiles').select('*').eq('user_id', userId).single(),
    supabase
      .from('water_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .gte('created_at', startDate)
      .lt('created_at', endDate),
    supabase
      .from('recharges')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', startDate)
      .lt('created_at', endDate),
  ]);

  const totalMl = (sessions || []).reduce((s, r) => s + r.volume_ml, 0);
  const totalCost = (sessions || []).reduce((s, r) => s + r.cost_rwf, 0);
  const totalRecharged = (recharges || []).reduce((s, r) => s + r.amount_rwf, 0);
  const pricing = getPricingInfo();

  const pdf = await buildPdfBuffer((doc) => {
    doc.fontSize(20).text('WASAC Water - Monthly Bill', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12);
    doc.text(`Customer: ${profile?.full_name || 'N/A'}`);
    doc.text(`Email: ${profile?.email || 'N/A'}`);
    doc.text(`Period: ${startDate} to ${endDate}`);
    doc.moveDown();
    doc.text(`Total Water Used: ${(totalMl / 1000).toFixed(2)} L (${totalMl} ml)`);
    doc.text(`Rate: ${pricing.pricePerLiter} RWF per liter (${pricing.pricePerMl.toFixed(4)} RWF per ml)`);
    doc.text(`Total Billed: ${totalCost} RWF`);
    doc.text(`Total Recharged: ${totalRecharged} RWF`);
    doc.moveDown();
    doc.text('Session Details:', { underline: true });
    (sessions || []).forEach((s, i) => {
      doc.text(
        `${i + 1}. ${new Date(s.created_at).toLocaleDateString()} - ${s.volume_ml} ml - ${s.cost_rwf} RWF`
      );
    });
    doc.moveDown(2);
    doc.text('Thank you for using WASAC Smart Water.', { align: 'center' });
  });

  return { pdf, filename: `bill-${userId}-${year}-${month}.pdf`, meta: { totalMl, totalCost } };
}

export async function generateRevenueReport(fromDate, toDate) {
  const { data: recharges, error } = await supabase
    .from('recharges')
    .select('amount_rwf, created_at, user_id')
    .gte('created_at', fromDate)
    .lte('created_at', toDate);

  if (error) throw new Error(error.message);

  const userIds = Array.from(new Set((recharges || []).map((r) => r.user_id)));
  const { data: profiles } = await supabase
    .from('profiles')
    .select('user_id, full_name')
    .in('user_id', userIds);

  const profileMap = (profiles || []).reduce((acc, profile) => {
    acc[profile.user_id] = profile.full_name;
    return acc;
  }, {});

  const total = (recharges || []).reduce((s, r) => s + r.amount_rwf, 0);

  const pdf = await buildPdfBuffer((doc) => {
    doc.fontSize(20).text('WASAC Revenue Report', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Period: ${fromDate} to ${toDate}`);
    doc.text(`Total Revenue: ${total} RWF`);
    doc.text(`Transactions: ${(recharges || []).length}`);
    doc.moveDown();
    (recharges || []).slice(0, 50).forEach((r, i) => {
      doc.text(
        `${i + 1}. ${profileMap[r.user_id] || 'Unknown'} - ${r.amount_rwf} RWF - ${new Date(r.created_at).toLocaleString()}`
      );
    });
  });

  return { pdf, filename: `revenue-${fromDate}-${toDate}.pdf`, total };
}
