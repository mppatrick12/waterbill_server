import { Router } from 'express';
import {
  identifyCard,
  createCard,
  rechargeCard,
  getMyCards,
  getBalance,
} from '../controllers/cardController.js';
import { authenticate, authorize, ROLES } from '../middleware/auth.js';
import { requireApprovedCustomer } from '../middleware/accountStatus.js';
import { deviceAuth } from '../middleware/deviceAuth.js';

const router = Router();

router.get('/identify/:uid', deviceAuth, identifyCard);
router.post('/identify', deviceAuth, identifyCard);
router.get('/my', authenticate, getMyCards);
router.get('/:id/balance', authenticate, getBalance);
router.post('/', authenticate, authorize(ROLES.ADMIN, ROLES.CUSTOMER), createCard);
router.post('/recharge', authenticate, requireApprovedCustomer, rechargeCard);

export default router;
