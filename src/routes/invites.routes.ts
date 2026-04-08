import { Router } from 'express';
import {
  createInvite,
  listInvites,
  respondToInvite,
} from '../controllers/invites.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

router.post('/', authenticateToken, createInvite);
router.get('/', authenticateToken, listInvites);
router.patch('/:id', authenticateToken, respondToInvite);

export default router;
