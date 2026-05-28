import { generateMonthlyBill, generateRevenueReport } from '../services/reportService.js';

export async function monthlyBill(req, res, next) {
  try {
    const userId = req.params.userId || req.user.id;
    const year = parseInt(req.params.year) || new Date().getFullYear();
    const month = parseInt(req.params.month) || new Date().getMonth() + 1;

    if (req.profile.role === 'customer' && userId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const { pdf, filename } = await generateMonthlyBill(userId, year, month);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
  } catch (err) {
    next(err);
  }
}

export async function revenueReport(req, res, next) {
  try {
    const from = req.query.from || new Date(new Date().setDate(1)).toISOString().split('T')[0];
    const to = req.query.to || new Date().toISOString().split('T')[0];
    const { pdf, filename } = await generateRevenueReport(from, to);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
  } catch (err) {
    next(err);
  }
}
