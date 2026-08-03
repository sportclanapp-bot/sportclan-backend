import { Router } from 'express';
import { guardIdParams } from '../middleware/uuidParams.middleware';
import { sendKudos, listReceivedKudos, getKudosCount } from '../controllers/kudos.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();
// SC-397: 400 on a malformed id instead of letting it reach Postgres and 500.
guardIdParams(router);

router.post('/', authenticateToken, sendKudos);
router.get('/received/:userId', authenticateToken, listReceivedKudos);
router.get('/count/:userId', authenticateToken, getKudosCount);

export default router;
