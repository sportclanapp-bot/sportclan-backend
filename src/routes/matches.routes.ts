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
  rateMatchHandler,
  setMatchTossHandler,
  getCommentary,
} from '../controllers/matches.controller';
import { getNearbyMatches } from '../controllers/features.controller';
import {
  getMatchMVP, getMatchAvailability, setMatchAvailability,
  applyDLS, editMatchEvent, deleteMatchEvent, getAICommentary,
} from '../controllers/matchFeatures.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

router.post('/', authenticateToken, createMatch);
router.get('/', authenticateToken, listMatches);
// /open and /nearby must come before /:id so they aren't captured as a match id.
router.get('/open', authenticateToken, listOpenMatches);
router.get('/nearby', authenticateToken, getNearbyMatches);
router.get('/:id/commentary', authenticateToken, getCommentary);
router.get('/:id', authenticateToken, getMatch);
router.patch('/:id', authenticateToken, updateMatch);
router.delete('/:id', authenticateToken, cancelMatch);
router.post('/:id/participants', authenticateToken, addParticipants);
router.post('/:id/umpire/self-assign', authenticateToken, selfAssignUmpire);
router.post('/:id/complete', authenticateToken, completeMatch);
router.post('/:id/join', authenticateToken, joinOpenMatch);
router.post('/:id/rate', authenticateToken, rateMatchHandler);
router.patch('/:id/toss', authenticateToken, setMatchTossHandler);
router.get('/:id/mvp', authenticateToken, getMatchMVP);
router.get('/:id/availability', authenticateToken, getMatchAvailability);
router.patch('/:id/availability', authenticateToken, setMatchAvailability);
router.post('/:id/dls', authenticateToken, applyDLS);
router.post('/:id/edit-event', authenticateToken, editMatchEvent);
router.delete('/:id/events/:eventId', authenticateToken, deleteMatchEvent);
router.get('/:id/ai-commentary', authenticateToken, getAICommentary);

export default router;
