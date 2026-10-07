import { typedScore } from '../controllers/scoring.controller';
import { Router } from 'express';
import { getBannedForMatch } from '../controllers/squads.controller';
import { decideMatch } from '../controllers/matchDecision.controller';
import { getMatchAssistants, setMatchAssistants, setOfficialReport } from '../controllers/matchOfficials.controller';
import { callToCourt, uncallMatch } from '../controllers/courtBoard.controller';
import { getTieLineup, setTieLineup } from '../controllers/tieLineup.controller';
import { guardIdParams } from '../middleware/uuidParams.middleware';
import {
  createMatch,
  listMatches,
  getMatch,
  updateMatch,
  addParticipants,
  selfAssignUmpire,
  setMatchOfficials,
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
  matchHistory,
  nextMatch,
} from '../controllers/matches.controller';
import { getNearbyMatches } from '../controllers/features.controller';
import { uploadHandoff } from '../controllers/qrHandoff.controller';
import {
  requestToJoinMatch,
  listMatchJoinRequests,
  decideMatchJoinRequest,
  withdrawMatchJoinRequest,
} from '../controllers/matchJoinRequests.controller';
import {
  getMatchMVP, getMatchAvailability, setMatchAvailability,
  applyDLS,
  reduceOvers, editMatchEvent, deleteMatchEvent, upsertInningsStats, getScoringEditLog,
} from '../controllers/matchFeatures.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();
// SC-397: 400 on a malformed id instead of letting it reach Postgres and 500.
guardIdParams(router);

router.post('/', authenticateToken, createMatch);
router.get('/', authenticateToken, listMatches);
// /open and /nearby must come before /:id so they aren't captured as a match id.
router.get('/open', authenticateToken, listOpenMatches);
// B04 (D1): Home's "Your next match" — before '/:id', or 'next' is read as an id.
router.get('/next', authenticateToken, nextMatch);
// Phase 3: played + officiated, before '/:id' so 'history' is not read as an id.
router.get('/history', authenticateToken, matchHistory);
router.get('/nearby', authenticateToken, getNearbyMatches);
router.get('/:id/commentary', authenticateToken, getCommentary);
// The scoring edit log — read-only, organiser / scorer / umpire / admin only.
router.get('/:id/edit-log', authenticateToken, getScoringEditLog);
router.get('/:id', authenticateToken, getMatch);
router.patch('/:id', authenticateToken, updateMatch);
router.delete('/:id', authenticateToken, cancelMatch);
router.post('/:id/cancel', authenticateToken, cancelMatch); // alias for frontend compatibility
router.post('/:id/abandon', authenticateToken, abandonMatch);
// Stage 8 · F12: an abandoned match's result stands, is replayed, or is awarded.
router.post('/:id/decide', authenticateToken, decideMatch);
// Stage 8 · F5: who is banned from this fixture.
router.get('/:id/banned', authenticateToken, getBannedForMatch);
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
// SC-432 · a signed QR handoff, uploaded by whoever has signal. The caller is a
// courier: authority comes from the signature, never from them.
router.post('/:id/handoff', authenticateToken, uploadHandoff);
router.post('/:id/follow', authenticateToken, followMatch);
router.delete('/:id/follow', authenticateToken, unfollowMatch);
router.get('/:id/chat', authenticateToken, getMatchChat);
router.post('/:id/participants', authenticateToken, addParticipants);
router.get('/:id/tie-lineup', authenticateToken, getTieLineup); // badminton 7.16
router.put('/:id/tie-lineup', authenticateToken, setTieLineup);
// Stage 10 · TT3: a paper-scored match typed in.
router.post('/:id/typed-score', authenticateToken, typedScore);
router.post('/:id/umpire/self-assign', authenticateToken, selfAssignUmpire);
// Cricket gap 3: the organiser names a fixture's umpire and scorer.
router.patch('/:id/officials', authenticateToken, setMatchOfficials);
// Stage 8 · F11: assistant officials and the official's report.
router.get('/:id/assistants', authenticateToken, getMatchAssistants);
router.put('/:id/assistants', authenticateToken, setMatchAssistants);
router.put('/:id/report', authenticateToken, setOfficialReport);
// Badminton gap 5: call a fixture to its court (both sides and the umpire are told), or undo it.
router.post('/:id/call', authenticateToken, callToCourt);
router.post('/:id/uncall', authenticateToken, uncallMatch);
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
router.post('/:id/reduce-overs', authenticateToken, reduceOvers); // BUILD 3.12
router.post('/:id/edit-event', authenticateToken, editMatchEvent);
router.delete('/:id/events/:eventId', authenticateToken, deleteMatchEvent);
router.post('/:id/innings-stats', authenticateToken, upsertInningsStats);
export default router;
