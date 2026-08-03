import { Router } from 'express';
import { guardIdParams } from '../middleware/uuidParams.middleware';
import { getUserBadges, evaluateBadges } from '../controllers/badges.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();
// SC-397: 400 on a malformed id instead of letting it reach Postgres and 500.
guardIdParams(router);

// SC-396: was PUBLIC — anyone with a user id could read another user's badge
// set with no token, bypassing the privacy rules every other profile read
// honours. Gated to match /users/* reads.
router.get('/users/:id/badges', authenticateToken, getUserBadges);
router.post('/evaluate/:userId', authenticateToken, evaluateBadges);

export default router;
