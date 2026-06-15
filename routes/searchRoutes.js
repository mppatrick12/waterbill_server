import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { search } from '../controllers/searchController.js';

const router = Router();
router.get('/', authenticate, search);
export default router;
