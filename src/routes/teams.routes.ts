import { Router } from 'express';
import { guardIdParams } from '../middleware/uuidParams.middleware';
import {
  createTeam,
  listTeams,
  getTeam,
  addTeamMember,
  removeTeamMember,
  listTeamBans,
  unbanTeamMember,
  updateMemberRole,
  updateTeam,
  joinTeamByCode,
  disbandTeam,
  requestToJoin,
  listJoinRequests,
  decideJoinRequest,
  withdrawJoinRequest,
} from '../controllers/teams.controller';
import { listExpenses, addExpense, updateExpense, deleteExpense, getExpenseSummary, listExpenseLog } from '../controllers/teamExpenses.controller';
import { getTeamInsights } from '../controllers/advancedStats.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();
// SC-397: 400 on a malformed id instead of letting it reach Postgres and 500.
guardIdParams(router);

router.post('/', authenticateToken, createTeam);
router.post('/join', authenticateToken, joinTeamByCode);
router.get('/', authenticateToken, listTeams);
router.get('/:id', authenticateToken, getTeam);
// SC-275: Team insights (PREMIUM + member-gated inside the handler). Additive.
router.get('/:id/insights', authenticateToken, getTeamInsights);
router.post('/:id/members', authenticateToken, addTeamMember);
router.delete('/:id/members/:userId', authenticateToken, removeTeamMember);
// SC-359 · removed-member (ban) visibility + undo. Managers only.
router.get('/:id/bans', authenticateToken, listTeamBans);
router.delete('/:id/bans/:userId', authenticateToken, unbanTeamMember);
router.patch('/:id/members/:userId/role', authenticateToken, updateMemberRole);
router.patch('/:id', authenticateToken, updateTeam);
router.delete('/:id', authenticateToken, disbandTeam);
router.post('/:id/join-requests', authenticateToken, requestToJoin);
router.get('/:id/join-requests', authenticateToken, listJoinRequests);
router.patch('/:id/join-requests/:userId', authenticateToken, decideJoinRequest);
router.delete('/:id/join-requests/me', authenticateToken, withdrawJoinRequest);
router.get('/:id/expenses', authenticateToken, listExpenses);
router.get('/:id/expenses/summary', authenticateToken, getExpenseSummary);
// SC-361: read-only by design — the audit trail has no write route, and the
// table is append-only in the database too (migration 077).
router.get('/:id/expenses/log', authenticateToken, listExpenseLog);
router.post('/:id/expenses', authenticateToken, addExpense);
router.patch('/:id/expenses/:expenseId', authenticateToken, updateExpense);
router.delete('/:id/expenses/:expenseId', authenticateToken, deleteExpense);

export default router;
