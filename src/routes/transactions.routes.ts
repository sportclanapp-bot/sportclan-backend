import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import { getTransactions } from '../controllers/transactions.controller';

const router = Router();

router.get('/', authenticateToken, getTransactions);

export default router;
