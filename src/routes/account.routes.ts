import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticateToken } from '../middleware/auth.middleware';
import {
  deleteAccount, getSessions, revokeSession,
  revokeAllSessions, submitFeedback, exportData,
  purgeExpiredAccounts,
} from '../controllers/account.controller';

const router = Router();

// SC-162: /account/export-data assembles a multi-query bundle — cheap to abuse
// on the free tier. Cap it PER USER (keyed on the authenticated userId, so a
// shared NAT/IP isn't collectively throttled) to a handful per hour. Returns a
// clean 429, never a 5xx. Mounted AFTER authenticateToken so req.userId exists.
const exportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req as { userId?: string }).userId ?? req.ip ?? 'anon',
  message: { error: 'Too many export requests. Please try again later.' },
});

router.post('/delete', authenticateToken, deleteAccount);
router.post('/export-data', authenticateToken, exportLimiter, exportData);
router.get('/sessions', authenticateToken, getSessions);
router.delete('/sessions/all', authenticateToken, revokeAllSessions);
router.delete('/sessions/:sessionId', authenticateToken, revokeSession);
router.post('/feedback', authenticateToken, submitFeedback);
// Cron-callable purge (X-Cron-Secret header required, no JWT)
router.post('/purge-expired', purgeExpiredAccounts);

export default router;
