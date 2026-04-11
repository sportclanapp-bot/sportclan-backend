import { Router } from 'express';
import { applyReferral, getStats } from '../controllers/referrals.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

router.post('/apply', authenticateToken, applyReferral);
router.get('/stats', authenticateToken, getStats);

export default router;
