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
  listOpenMatches,
  joinOpenMatch,
} from '../controllers/matches.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

router.post('/', authenticateToken, createMatch);
router.get('/', authenticateToken, listMatches);
// /open must come before /:id so it isn't captured as a match id.
router.get('/open', authenticateToken, listOpenMatches);
router.get('/:id', authenticateToken, getMatch);
router.patch('/:id', authenticateToken, updateMatch);
router.delete('/:id', authenticateToken, cancelMatch);
router.post('/:id/participants', authenticateToken, addParticipants);
router.post('/:id/umpire/self-assign', authenticateToken, selfAssignUmpire);
router.post('/:id/complete', authenticateToken, completeMatch);
router.post('/:id/join', authenticateToken, joinOpenMatch);

export default router;
