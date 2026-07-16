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
  requestToJoin,
  listJoinRequests,
  decideJoinRequest,
  withdrawJoinRequest,
} from '../controllers/teams.controller';
import { listExpenses, addExpense, deleteExpense, getExpenseSummary } from '../controllers/teamExpenses.controller';
import { getTeamInsights } from '../controllers/advancedStats.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

router.post('/', authenticateToken, createTeam);
router.post('/join', authenticateToken, joinTeamByCode);
router.get('/', authenticateToken, listTeams);
router.get('/:id', authenticateToken, getTeam);
// SC-275: Team insights (PREMIUM + member-gated inside the handler). Additive.
router.get('/:id/insights', authenticateToken, getTeamInsights);
router.post('/:id/members', authenticateToken, addTeamMember);
router.delete('/:id/members/:userId', authenticateToken, removeTeamMember);
router.patch('/:id/members/:userId/role', authenticateToken, updateMemberRole);
router.patch('/:id', authenticateToken, updateTeam);
router.delete('/:id', authenticateToken, disbandTeam);
router.post('/:id/join-requests', authenticateToken, requestToJoin);
router.get('/:id/join-requests', authenticateToken, listJoinRequests);
router.patch('/:id/join-requests/:userId', authenticateToken, decideJoinRequest);
router.delete('/:id/join-requests/me', authenticateToken, withdrawJoinRequest);
router.get('/:id/expenses', authenticateToken, listExpenses);
router.get('/:id/expenses/summary', authenticateToken, getExpenseSummary);
router.post('/:id/expenses', authenticateToken, addExpense);
router.delete('/:id/expenses/:expenseId', authenticateToken, deleteExpense);

export default router;
