import { Router } from 'express';
import { getLeaderboard } from '../controllers/leaderboard.controller';
import { getPlayerOfWeek } from '../controllers/features.controller';
import { getScorerLeaderboard } from '../controllers/insights.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

router.get('/', authenticateToken, getLeaderboard);
router.get('/player-of-week', authenticateToken, getPlayerOfWeek);
router.get('/scorers', authenticateToken, getScorerLeaderboard);

export default router;
