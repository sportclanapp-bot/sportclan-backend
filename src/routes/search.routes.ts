import { Router } from 'express';
import { search } from '../controllers/search.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

router.get('/', authenticateToken, search);

export default router;
