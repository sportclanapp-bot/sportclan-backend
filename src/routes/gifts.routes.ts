import { Router, Request, Response, NextFunction } from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import {
  getCatalogue, sendGift, getReceivedGifts, getSentGifts,
} from '../controllers/gifts.controller';

const router = Router();

// SC-116: the `/gifts` mount sets `Cache-Control: public, max-age=3600` (cacheFor)
// — correct for the STATIC catalogue, but wrong for the AUTHED per-user routes
// below (received/sent are one user's private gift ledger: sender identities +
// messages). `public` would let a shared cache/CDN serve one user's list to
// another. Override those to `private, no-store` so only the caller ever sees them.
const noStore = (_req: Request, res: Response, next: NextFunction) => {
  res.set('Cache-Control', 'private, no-store');
  next();
};

router.get('/catalogue', getCatalogue);                // Public + shared-cacheable (static)
// Phase 3 B10-F15: noStore goes BEFORE the auth check — after it, a 401 still
// carried the mount's `public, max-age=3600`.
router.post('/send', noStore, authenticateToken, sendGift);
router.get('/received', noStore, authenticateToken, getReceivedGifts);
router.get('/sent', noStore, authenticateToken, getSentGifts);

export default router;
