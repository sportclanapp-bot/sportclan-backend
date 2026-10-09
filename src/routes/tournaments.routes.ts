import { redraw } from '../controllers/redraw.controller';
import { listAnnouncements, postAnnouncement, deleteAnnouncement } from '../controllers/announcements.controller';
import { getSquad, setSquad, checkSquadPlayer, setSquadLock, getDiscipline } from '../controllers/squads.controller';
import { setLots } from '../controllers/lots.controller';
import { getSwiss, setSwissBye, swapSwissPairing, publishSwissRound } from '../controllers/swiss.controller';
import { Router } from 'express';
import { guardIdParams } from '../middleware/uuidParams.middleware';
import {
  createTournament,
  addEvents,
  listTournaments,
  getTournament,
  getEntriesPage,
  createEntry,
  directAddTeam,
  updateEntry,
  getLuckyLosers,
  getLadder,
  createLadderChallenge,
  nextBoxRound,
  addLuckyLoser,
  updateTournament,
  joinByCode,
  tournamentByCode,
  joinOptions,
  myTeamsForEntry,
  entryCheck,
  getBracket,
  updateFixtures,
  getTournamentChat,
  generateFixtures,
  getTournamentOrganisers,
  addTournamentOrganiser,
  removeTournamentOrganiser,
  reassignTournamentOrganiser,
} from '../controllers/tournaments.controller';
import {
  getTournamentAnalytics,
  getTournamentStandings,
  getTournamentTopPerformers,
  addTournamentOfficial,
  removeTournamentOfficial,
  getTournamentOfficials,
} from '../controllers/features.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { getPlacings, getAwards, setAwards } from '../controllers/awards.controller';
import { getCourtBoard, nextToCourt, runningLate } from '../controllers/courtBoard.controller';
import { enterSelf, addPlayersEntry, createPairInvite, answerPairInvite, getPairs, relatedEntries } from '../controllers/pairEntries.controller';
import {
  getOfflinePack, claimHub, heartbeatHub, releaseHub, takeOverHub,
  listDiscrepancies, resolveDiscrepancy,
} from '../controllers/tournamentHub.controller';

const router = Router();
// SC-397: 400 on a malformed id instead of letting it reach Postgres and 500.
guardIdParams(router);

router.post('/', authenticateToken, createTournament);
router.get('/', authenticateToken, listTournaments);
router.post('/join', authenticateToken, joinByCode);
// 6 Oct 2026: a code's tournament, and which teams can enter it (before picking one).
router.get('/code/:code', authenticateToken, tournamentByCode);
router.get('/code/:code/teams', authenticateToken, joinOptions);
router.post('/:id/entry-check', authenticateToken, entryCheck);
router.get('/:id/my-teams', authenticateToken, myTeamsForEntry);
router.get('/:id', authenticateToken, getTournament);
router.get('/:id/bracket', authenticateToken, getBracket);
router.patch('/:id', authenticateToken, updateTournament);
router.post('/:id/events', authenticateToken, addEvents); // badminton gap 1
router.patch('/:id/fixtures', authenticateToken, updateFixtures);
router.post('/:id/generate-fixtures', authenticateToken, generateFixtures);
router.post('/:id/redraw', authenticateToken, redraw); // badminton 7.13
router.get('/:id/analytics', authenticateToken, getTournamentAnalytics);
router.get('/:id/standings', authenticateToken, getTournamentStandings);
router.get('/:id/top-performers', authenticateToken, getTournamentTopPerformers);
router.get('/:id/chat', authenticateToken, getTournamentChat);
router.get('/:id/officials', authenticateToken, getTournamentOfficials);
router.post('/:id/officials', authenticateToken, addTournamentOfficial);
router.delete('/:id/officials/:officialId', authenticateToken, removeTournamentOfficial);
router.get('/:id/organisers', authenticateToken, getTournamentOrganisers);
router.post('/:id/organisers', authenticateToken, addTournamentOrganiser);
router.delete('/:id/organisers/:userId', authenticateToken, removeTournamentOrganiser);
router.post('/:id/reassign-organiser', authenticateToken, reassignTournamentOrganiser);
router.post('/:id/entries/direct', authenticateToken, directAddTeam);
router.post('/:id/entries', authenticateToken, createEntry);
router.patch('/:id/entries/:entryId', authenticateToken, updateEntry);
// Stage 9 · T7: lucky losers from the qualifying draws.
router.get('/:id/lucky-losers', authenticateToken, getLuckyLosers);
// Stage 9 · T16: ladders and box leagues.
router.get('/:id/ladder', authenticateToken, getLadder);
router.post('/:id/ladder/challenges', authenticateToken, createLadderChallenge);
router.post('/:id/box/next-round', authenticateToken, nextBoxRound);
router.post('/:id/lucky-losers', authenticateToken, addLuckyLoser);
// Badminton gap 2: singles and pair entries.
router.post('/:id/enter-self', authenticateToken, enterSelf);
router.post('/:id/entries/players', authenticateToken, addPlayersEntry);
router.get('/:id/pairs', authenticateToken, getPairs);
router.post('/:id/pair-invites', authenticateToken, createPairInvite);
router.post('/:id/pair-invites/:inviteId/:action', authenticateToken, answerPairInvite);
// Badminton gap 5: the court board, sending the next match to a free court, running late.
router.get('/:id/court-board', authenticateToken, getCourtBoard);
// Badminton gap 8: winner, runner-up, semi-finalists (per event), with the players.
router.get('/:id/placings', authenticateToken, getPlacings);
// Stage 8 · F7: computed and organiser's awards.
router.get('/:id/awards', authenticateToken, getAwards);
router.put('/:id/awards', authenticateToken, setAwards);
// Stage 8 · F8: a draw of lots for teams level on every tie-break.
router.put('/:id/lots', authenticateToken, setLots);
// Stage 12 · CH2: a Swiss run the FIDE way — byes asked for, checking / swapping, publishing.
router.get('/:id/swiss', authenticateToken, getSwiss);
router.put('/:id/swiss/byes', authenticateToken, setSwissBye);
router.post('/:id/swiss/swap', authenticateToken, swapSwissPairing);
router.post('/:id/swiss/publish', authenticateToken, publishSwissRound);
// Stage 8 · F3 / F16 / F5: squads, ID checks, bans.
router.get('/:id/squads/:teamId', authenticateToken, getSquad);
router.put('/:id/squads/:teamId', authenticateToken, setSquad);
router.patch('/:id/squads/:teamId/check', authenticateToken, checkSquadPlayer);
router.put('/:id/squad-lock', authenticateToken, setSquadLock);
router.get('/:id/discipline', authenticateToken, getDiscipline);
// Stage 8 · F21: the organiser's announcements (any sport).
router.get('/:id/announcements', authenticateToken, listAnnouncements);
router.post('/:id/announcements', authenticateToken, postAnnouncement);
router.delete('/:id/announcements/:aid', authenticateToken, deleteAnnouncement);
router.get('/:id/entries', authenticateToken, getEntriesPage); // Oct 2026: entries a page at a time
// Badminton gap 6: after a retirement, the entry here and its players' entries in the other events.
router.get('/:id/teams/:teamId/related-entries', authenticateToken, relatedEntries);
router.post('/:id/next-to-court', authenticateToken, nextToCourt);
router.post('/:id/running-late', authenticateToken, runningLate);

// SC-433 · the offline tournament hub. The pack is everything the organiser's
// phone needs for a day with no signal; the lease keeps it to one phone; the
// discrepancies are the arguments the server refused to settle on its own.
router.get('/:id/offline-pack', authenticateToken, getOfflinePack);
router.post('/:id/hub-lease', authenticateToken, claimHub);
router.post('/:id/hub-lease/heartbeat', authenticateToken, heartbeatHub);
router.post('/:id/hub-lease/release', authenticateToken, releaseHub);
router.post('/:id/hub-lease/takeover', authenticateToken, takeOverHub);
router.get('/:id/discrepancies', authenticateToken, listDiscrepancies);
router.post('/:id/discrepancies/:discrepancyId/resolve', authenticateToken, resolveDiscrepancy);

export default router;
