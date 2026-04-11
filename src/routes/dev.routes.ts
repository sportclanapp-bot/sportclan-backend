import { Router } from 'express';
import { loadTestData } from '../controllers/dev.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

router.post('/load-test-data', authenticateToken, loadTestData);

export default router;
