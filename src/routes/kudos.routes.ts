import { Router } from 'express';
import { sendKudos, listReceivedKudos, getKudosCount } from '../controllers/kudos.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

router.post('/', authenticateToken, sendKudos);
router.get('/received/:userId', authenticateToken, listReceivedKudos);
router.get('/count/:userId', authenticateToken, getKudosCount);

export default router;
