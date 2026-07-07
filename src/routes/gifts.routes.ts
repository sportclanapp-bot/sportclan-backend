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
router.post('/send', authenticateToken, noStore, sendGift);
router.get('/received', authenticateToken, noStore, getReceivedGifts);
router.get('/sent', authenticateToken, noStore, getSentGifts);

export default router;
