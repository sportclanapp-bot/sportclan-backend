import { Router } from 'express';
import {
  createTeam,
  listTeams,
  getTeam,
  addTeamMember,
  removeTeamMember,
  updateTeam,
} from '../controllers/teams.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

router.post('/', authenticateToken, createTeam);
router.get('/', authenticateToken, listTeams);
router.get('/:id', authenticateToken, getTeam);
router.post('/:id/members', authenticateToken, addTeamMember);
router.delete('/:id/members/:userId', authenticateToken, removeTeamMember);
router.patch('/:id', authenticateToken, updateTeam);

export default router;
