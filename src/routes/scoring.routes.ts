import { Router } from 'express';
import { guardIdParams } from '../middleware/uuidParams.middleware';
import { createEvent, listEvents, undoEvent } from '../controllers/scoring.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();
// SC-397: 400 on a malformed id instead of letting it reach Postgres and 500.
guardIdParams(router);

router.post('/:matchId/event', authenticateToken, createEvent);
router.get('/:matchId/events', authenticateToken, listEvents);
router.post('/:matchId/undo', authenticateToken, undoEvent);

export default router;
