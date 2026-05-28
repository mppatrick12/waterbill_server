import { Router } from 'express';
import { listAlerts, resolveAlert } from '../controllers/alertController.js';
import { authenticate, authorize, ROLES } from '../middleware/auth.js';

const router = Router();

router.get('/leaks', authenticate, listAlerts);
router.patch('/leaks/:id/resolve', authenticate, authorize(ROLES.ADMIN, ROLES.WASAC_MANAGER), resolveAlert);

export default router;
