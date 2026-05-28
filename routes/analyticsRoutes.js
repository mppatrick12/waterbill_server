import { Router } from 'express';
import {
  overview,
  usageGraph,
  topConsumers,
  waterLoss,
  predict,
  myUsage,
} from '../controllers/analyticsController.js';
import { authenticate, authorize, ROLES } from '../middleware/auth.js';

const router = Router();

router.get('/overview', authenticate, authorize(ROLES.ADMIN, ROLES.WASAC_MANAGER), overview);
router.get('/usage-graph', authenticate, authorize(ROLES.ADMIN, ROLES.WASAC_MANAGER), usageGraph);
router.get('/top-consumers', authenticate, authorize(ROLES.ADMIN, ROLES.WASAC_MANAGER), topConsumers);
router.get('/water-loss', authenticate, authorize(ROLES.ADMIN, ROLES.WASAC_MANAGER), waterLoss);
router.get('/predict/:userId?', authenticate, predict);
router.get('/my-usage', authenticate, myUsage);

export default router;
