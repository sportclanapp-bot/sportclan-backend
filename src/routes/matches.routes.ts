import { Router } from 'express';
import {
  createMatch,
  listMatches,
  getMatch,
  updateMatch,
  addParticipants,
  selfAssignUmpire,
  cancelMatch,
  completeMatch,
} from '../controllers/matches.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

router.post('/', authenticateToken, createMatch);
router.get('/', authenticateToken, listMatches);
router.get('/:id', authenticateToken, getMatch);
router.patch('/:id', authenticateToken, updateMatch);
router.delete('/:id', authenticateToken, cancelMatch);
router.post('/:id/participants', authenticateToken, addParticipants);
router.post('/:id/umpire/self-assign', authenticateToken, selfAssignUmpire);
router.post('/:id/complete', authenticateToken, completeMatch);

export default router;
