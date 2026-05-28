import { Router } from 'express';
import { monthlyBill, revenueReport } from '../controllers/reportController.js';
import { authenticate, authorize, ROLES } from '../middleware/auth.js';

const router = Router();

router.get('/bill/:userId?/:year?/:month?', authenticate, monthlyBill);
router.get('/revenue', authenticate, authorize(ROLES.ADMIN, ROLES.WASAC_MANAGER), revenueReport);

export default router;
