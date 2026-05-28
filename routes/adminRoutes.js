import { Router } from 'express';
import { authenticate, authorize, ROLES } from '../middleware/auth.js';
import {
  getWaterFetchControl,
  setWaterFetchControl,
} from '../controllers/waterControlController.js';
import {
  listAdminCards,
  createAdminCard,
  setAdminCardActive,
  rechargeAdminCard,
  assignAdminCardToUser,
  deleteAdminCard,
} from '../controllers/adminCardController.js';
import {
  listAdminDevices,
  createAdminDevice,
  setAdminDeviceStatus,
  registerAdminDevice,
} from '../controllers/adminDeviceController.js';
import { getAdminMqttStatus } from '../controllers/adminDeviceController.js';

const router = Router();

router.get('/system/water-fetch', authenticate, authorize(ROLES.ADMIN), getWaterFetchControl);
router.patch('/system/water-fetch', authenticate, authorize(ROLES.ADMIN), setWaterFetchControl);

router.get('/cards', authenticate, authorize(ROLES.ADMIN), listAdminCards);
router.post('/cards', authenticate, authorize(ROLES.ADMIN), createAdminCard);
router.patch('/cards/:cardId/assign', authenticate, authorize(ROLES.ADMIN), assignAdminCardToUser);
router.patch('/cards/:cardId/active', authenticate, authorize(ROLES.ADMIN), setAdminCardActive);
router.post('/cards/:cardId/recharge', authenticate, authorize(ROLES.ADMIN), rechargeAdminCard);
router.delete('/cards/:cardId', authenticate, authorize(ROLES.ADMIN), deleteAdminCard);

router.get('/devices', authenticate, authorize(ROLES.ADMIN), listAdminDevices);
router.post('/devices', authenticate, authorize(ROLES.ADMIN), createAdminDevice);
router.patch('/devices/:deviceId/status', authenticate, authorize(ROLES.ADMIN), setAdminDeviceStatus);
router.post('/devices/:deviceId/register', authenticate, authorize(ROLES.ADMIN), registerAdminDevice);
router.get('/mqtt-status', authenticate, authorize(ROLES.ADMIN), getAdminMqttStatus);

export default router;

