import { Router } from 'express';
import { loadFullData } from '../controllers/dev.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

// POST /dev/load-full-data — comprehensive test-data seeder.
// Remove before the production Store build.
router.post('/load-full-data', authenticateToken, loadFullData);

export default router;
