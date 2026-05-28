import { Router } from 'express';
import {
  identify,
  authorize,
  flowTick,
  complete,
  getSessions,
} from '../controllers/waterController.js';
import { authenticate } from '../middleware/auth.js';
import { deviceAuth } from '../middleware/deviceAuth.js';
import { requireApprovedCustomer } from '../middleware/accountStatus.js';

const router = Router();

router.get('/identify/:uid', deviceAuth, identify);
router.post('/authorize', deviceAuth, authorize);
router.post('/request', authenticate, requireApprovedCustomer, authorize);
router.post('/flow-tick', deviceAuth, flowTick);
router.post('/complete', deviceAuth, complete);
router.post('/complete/:sessionId', deviceAuth, complete);
router.get('/sessions', authenticate, getSessions);
router.get('/sessions/:userId', authenticate, getSessions);

export default router;
