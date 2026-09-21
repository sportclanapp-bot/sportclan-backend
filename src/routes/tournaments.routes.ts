import { Router } from 'express';
import { guardIdParams } from '../middleware/uuidParams.middleware';
import {
  createTournament,
  listTournaments,
  getTournament,
  createEntry,
  directAddTeam,
  updateEntry,
  updateTournament,
  joinByCode,
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
router.get('/:id', authenticateToken, getTournament);
router.get('/:id/bracket', authenticateToken, getBracket);
router.patch('/:id', authenticateToken, updateTournament);
router.patch('/:id/fixtures', authenticateToken, updateFixtures);
router.post('/:id/generate-fixtures', authenticateToken, generateFixtures);
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
