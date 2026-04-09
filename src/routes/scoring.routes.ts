import { Router } from 'express';
import { createEvent, listEvents, undoEvent } from '../controllers/scoring.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

router.post('/:matchId/event', authenticateToken, createEvent);
router.get('/:matchId/events', authenticateToken, listEvents);
router.post('/:matchId/undo', authenticateToken, undoEvent);

export default router;
