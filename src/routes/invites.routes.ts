import { Router } from 'express';
import {
  createInvite,
  listInvites,
  respondToInvite,
  withdrawInvite,
} from '../controllers/invites.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

router.post('/', authenticateToken, createInvite);
router.get('/', authenticateToken, listInvites);
router.patch('/:id', authenticateToken, respondToInvite);
router.delete('/:id', authenticateToken, withdrawInvite);

export default router;
