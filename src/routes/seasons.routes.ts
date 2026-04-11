import { Router } from 'express';
import { getCurrentSeason, endSeason } from '../controllers/seasons.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

router.get('/current', authenticateToken, getCurrentSeason);
// POST /seasons/end is protected via the X-Admin-Key header check inside
// the controller itself — no auth middleware needed.
router.post('/end', endSeason);

export default router;
