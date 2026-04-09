import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import {
  deleteAccount, getSessions, revokeSession,
  revokeAllSessions, submitFeedback,
} from '../controllers/account.controller';

const router = Router();

router.post('/delete', authenticateToken, deleteAccount);
router.get('/sessions', authenticateToken, getSessions);
router.delete('/sessions/all', authenticateToken, revokeAllSessions);
router.delete('/sessions/:sessionId', authenticateToken, revokeSession);
router.post('/feedback', authenticateToken, submitFeedback);

export default router;
