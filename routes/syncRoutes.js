import { Router } from 'express';
import { batchSync, pendingSync } from '../controllers/syncController.js';
import { deviceAuth } from '../middleware/deviceAuth.js';
import { authenticate, authorize, ROLES } from '../middleware/auth.js';

const router = Router();

router.post('/batch', deviceAuth, batchSync);
router.get('/pending/:deviceId', authenticate, authorize(ROLES.ADMIN), pendingSync);

export default router;
