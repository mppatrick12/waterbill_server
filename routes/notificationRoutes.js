import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  getMyNotifications,
  markRead,
  markAllRead,
  sendNotification,
} from '../controllers/notificationController.js';

const router = Router();

router.get('/my',            authenticate, getMyNotifications);
router.patch('/read-all',    authenticate, markAllRead);
router.patch('/:id/read',    authenticate, markRead);
router.post('/send',         authenticate, sendNotification);

export default router;
