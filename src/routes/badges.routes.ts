import { Router } from 'express';
import { getUserBadges, evaluateBadges } from '../controllers/badges.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

router.get('/users/:id/badges', getUserBadges);
router.post('/evaluate/:userId', authenticateToken, evaluateBadges);

export default router;
