import { Router } from 'express';
import { register, login, getMe, ensureAdmin, updateProfile, changePassword } from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/ensure-admin', ensureAdmin);
router.get('/me', authenticate, getMe);
router.patch('/profile', authenticate, updateProfile);
router.post('/change-password', authenticate, changePassword);

export default router;
