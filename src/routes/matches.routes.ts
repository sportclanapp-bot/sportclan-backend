import { Router } from 'express';
import { guardIdParams } from '../middleware/uuidParams.middleware';
import {
  createMatch,
  listMatches,
  getMatch,
  updateMatch,
  addParticipants,
  selfAssignUmpire,
  cancelMatch,
  abandonMatch,
  voidMatch,
  unvoidMatch,
  claimScoringLease,
  heartbeatScoringLease,
  releaseScoringLease,
  takeOverScoringLease,
  handOverScoringLease,
  followMatch,
  unfollowMatch,
  getMatchChat,
  completeMatch,
  listOpenMatches,
  joinOpenMatch,
  leaveMatch,
  rateMatchHandler,
  setMatchTossHandler,
  getCommentary,
} from '../controllers/matches.controller';
import { getNearbyMatches } from '../controllers/features.controller';
import {
  requestToJoinMatch,
  listMatchJoinRequests,
  decideMatchJoinRequest,
  withdrawMatchJoinRequest,
} from '../controllers/matchJoinRequests.controller';
import {
  getMatchMVP, getMatchAvailability, setMatchAvailability,
  applyDLS, editMatchEvent, deleteMatchEvent, upsertInningsStats,
} from '../controllers/matchFeatures.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();
// SC-397: 400 on a malformed id instead of letting it reach Postgres and 500.
guardIdParams(router);

router.post('/', authenticateToken, createMatch);
router.get('/', authenticateToken, listMatches);
// /open and /nearby must come before /:id so they aren't captured as a match id.
router.get('/open', authenticateToken, listOpenMatches);
router.get('/nearby', authenticateToken, getNearbyMatches);
router.get('/:id/commentary', authenticateToken, getCommentary);
router.get('/:id', authenticateToken, getMatch);
router.patch('/:id', authenticateToken, updateMatch);
router.delete('/:id', authenticateToken, cancelMatch);
router.post('/:id/cancel', authenticateToken, cancelMatch); // alias for frontend compatibility
router.post('/:id/abandon', authenticateToken, abandonMatch);
// SC-424: void keeps the match and its events and stops it counting anywhere.
router.post('/:id/void', authenticateToken, voidMatch);
router.post('/:id/unvoid', authenticateToken, unvoidMatch);
// SC-430 · one scorer per match. Claim on opening the pad, heartbeat while it is
// open, release on leaving. A STALE lease is takeable — with a reason — but never
// auto-released, so an offline scorer's queue survives. See utils/scoringLease.
router.post('/:id/scoring-lease', authenticateToken, claimScoringLease);
router.post('/:id/scoring-lease/heartbeat', authenticateToken, heartbeatScoringLease);
router.post('/:id/scoring-lease/release', authenticateToken, releaseScoringLease);
router.post('/:id/scoring-lease/handover', authenticateToken, handOverScoringLease);
router.post('/:id/scoring-lease/takeover', authenticateToken, takeOverScoringLease);
router.post('/:id/follow', authenticateToken, followMatch);
router.delete('/:id/follow', authenticateToken, unfollowMatch);
router.get('/:id/chat', authenticateToken, getMatchChat);
router.post('/:id/participants', authenticateToken, addParticipants);
router.post('/:id/umpire/self-assign', authenticateToken, selfAssignUmpire);
router.post('/:id/complete', authenticateToken, completeMatch);
router.post('/:id/join', authenticateToken, joinOpenMatch);
router.post('/:id/leave', authenticateToken, leaveMatch);
// SC-279: match join request/approve (approval-policy matches). Creator approves.
router.post('/:id/join-requests', authenticateToken, requestToJoinMatch);
router.get('/:id/join-requests', authenticateToken, listMatchJoinRequests);
router.delete('/:id/join-requests/me', authenticateToken, withdrawMatchJoinRequest);
router.patch('/:id/join-requests/:userId', authenticateToken, decideMatchJoinRequest);
router.post('/:id/rate', authenticateToken, rateMatchHandler);
router.patch('/:id/toss', authenticateToken, setMatchTossHandler);
router.get('/:id/mvp', authenticateToken, getMatchMVP);
router.get('/:id/availability', authenticateToken, getMatchAvailability);
router.patch('/:id/availability', authenticateToken, setMatchAvailability);
router.post('/:id/dls', authenticateToken, applyDLS);
router.post('/:id/edit-event', authenticateToken, editMatchEvent);
router.delete('/:id/events/:eventId', authenticateToken, deleteMatchEvent);
router.post('/:id/innings-stats', authenticateToken, upsertInningsStats);
export default router;
