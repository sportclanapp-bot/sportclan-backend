import { Router } from 'express';
import {
  createTeam,
  listTeams,
  getTeam,
  addTeamMember,
  removeTeamMember,
  updateMemberRole,
  updateTeam,
  joinTeamByCode,
  disbandTeam,
} from '../controllers/teams.controller';
import { listExpenses, addExpense, deleteExpense, getExpenseSummary } from '../controllers/teamExpenses.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

router.post('/', authenticateToken, createTeam);
router.post('/join', authenticateToken, joinTeamByCode);
router.get('/', authenticateToken, listTeams);
router.get('/:id', authenticateToken, getTeam);
router.post('/:id/members', authenticateToken, addTeamMember);
router.delete('/:id/members/:userId', authenticateToken, removeTeamMember);
router.patch('/:id/members/:userId/role', authenticateToken, updateMemberRole);
router.patch('/:id', authenticateToken, updateTeam);
router.delete('/:id', authenticateToken, disbandTeam);
router.get('/:id/expenses', authenticateToken, listExpenses);
router.get('/:id/expenses/summary', authenticateToken, getExpenseSummary);
router.post('/:id/expenses', authenticateToken, addExpense);
router.delete('/:id/expenses/:expenseId', authenticateToken, deleteExpense);

export default router;
