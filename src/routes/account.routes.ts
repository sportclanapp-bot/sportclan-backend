import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import {
  deleteAccount, getSessions, revokeSession,
  revokeAllSessions, submitFeedback, exportData,
  purgeExpiredAccounts,
} from '../controllers/account.controller';

const router = Router();

router.post('/delete', authenticateToken, deleteAccount);
router.post('/export-data', authenticateToken, exportData);
router.get('/sessions', authenticateToken, getSessions);
router.delete('/sessions/all', authenticateToken, revokeAllSessions);
router.delete('/sessions/:sessionId', authenticateToken, revokeSession);
router.post('/feedback', authenticateToken, submitFeedback);
// Cron-callable purge (X-Cron-Secret header required, no JWT)
router.post('/purge-expired', purgeExpiredAccounts);

export default router;
