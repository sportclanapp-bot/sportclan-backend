import { Router } from 'express';
import { guardIdParams } from '../middleware/uuidParams.middleware';
import rateLimit from 'express-rate-limit';
import { RedisRateLimitStore } from '../utils/rateLimitStore';
import { authenticateToken } from '../middleware/auth.middleware';
import { clientIpKey } from '../middleware/rateLimitKey';
import {
  deleteAccount, getSessions, revokeSession,
  revokeAllSessions, submitFeedback, exportData,
  purgeExpiredAccounts,
} from '../controllers/account.controller';

const router = Router();
// SC-397: 400 on a malformed id instead of letting it reach Postgres and 500.
guardIdParams(router);

// SC-162: /account/export-data assembles a multi-query bundle — cheap to abuse
// on the free tier. Cap it PER USER (keyed on the authenticated userId, so a
// shared NAT/IP isn't collectively throttled) to a handful per hour. Returns a
// clean 429, never a 5xx. Mounted AFTER authenticateToken so req.userId exists.
const exportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  // No user id can't happen after authenticateToken; if it ever did, the
  // address is grouped IPv6-safely like every other limiter.
  keyGenerator: (req) => (req as { userId?: string }).userId ?? clientIpKey(req),
  message: { error: 'Too many export requests. Please try again later.' },
  store: new RedisRateLimitStore('export', 'blocking'),
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
