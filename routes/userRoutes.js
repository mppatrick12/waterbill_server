import { Router } from 'express';
import {
  listUsers,
  listPendingCustomers,
  updateAccountApproval,
  updateUserRole,
  createUser,
  deleteUser,
} from '../controllers/userController.js';
import { authenticate, authorize, ROLES } from '../middleware/auth.js';

const router = Router();
const managers = [ROLES.ADMIN, ROLES.WASAC_MANAGER];

router.get('/pending', authenticate, authorize(...managers), listPendingCustomers);
router.get('/', authenticate, authorize(ROLES.ADMIN), listUsers);
router.post('/', authenticate, authorize(ROLES.ADMIN), createUser);
router.patch('/:userId/approval', authenticate, authorize(...managers), updateAccountApproval);
router.patch('/:userId/role', authenticate, authorize(ROLES.ADMIN), updateUserRole);
router.delete('/:userId', authenticate, authorize(ROLES.ADMIN), deleteUser);

export default router;
