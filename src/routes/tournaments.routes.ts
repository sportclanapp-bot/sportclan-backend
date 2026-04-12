import { Router } from 'express';
import {
  createTournament,
  listTournaments,
  getTournament,
  createEntry,
  updateEntry,
  updateTournament,
  joinByCode,
  getBracket,
  updateFixtures,
  getTournamentChat,
  generateFixtures,
} from '../controllers/tournaments.controller';
import { getTournamentAnalytics } from '../controllers/features.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

router.post('/', authenticateToken, createTournament);
router.get('/', authenticateToken, listTournaments);
router.post('/join', authenticateToken, joinByCode);
router.get('/:id', authenticateToken, getTournament);
router.get('/:id/bracket', authenticateToken, getBracket);
router.patch('/:id', authenticateToken, updateTournament);
router.patch('/:id/fixtures', authenticateToken, updateFixtures);
router.post('/:id/generate-fixtures', authenticateToken, generateFixtures);
router.get('/:id/analytics', authenticateToken, getTournamentAnalytics);
router.get('/:id/chat', authenticateToken, getTournamentChat);
router.post('/:id/entries', authenticateToken, createEntry);
router.patch('/:id/entries/:entryId', authenticateToken, updateEntry);

export default router;
