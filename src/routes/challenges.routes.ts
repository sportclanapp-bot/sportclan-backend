import { Router } from 'express';
import { listChallenges } from '../controllers/challenges.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

router.get('/', authenticateToken, listChallenges);

export default router;
