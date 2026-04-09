import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import {
  getCatalogue, sendGift, getReceivedGifts, getSentGifts,
} from '../controllers/gifts.controller';

const router = Router();

router.get('/catalogue', getCatalogue);                // Public
router.post('/send', authenticateToken, sendGift);
router.get('/received', authenticateToken, getReceivedGifts);
router.get('/sent', authenticateToken, getSentGifts);

export default router;
