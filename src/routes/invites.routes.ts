import { Router } from 'express';
import { guardIdParams } from '../middleware/uuidParams.middleware';
import {
  createInvite,
  listInvites,
  respondToInvite,
  withdrawInvite,
} from '../controllers/invites.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();
// SC-397: 400 on a malformed id instead of letting it reach Postgres and 500.
guardIdParams(router);

router.post('/', authenticateToken, createInvite);
router.get('/', authenticateToken, listInvites);
router.patch('/:id', authenticateToken, respondToInvite);
router.delete('/:id', authenticateToken, withdrawInvite);

export default router;
