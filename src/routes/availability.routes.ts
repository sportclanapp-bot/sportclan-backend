import { Router } from 'express';
import { getAvailability, updateAvailability } from '../controllers/availability.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

router.get('/', authenticateToken, getAvailability);
router.put('/', authenticateToken, updateAvailability);

export default router;
