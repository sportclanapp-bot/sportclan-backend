import { refuseDisbandedTeam, refuseEntryTeam } from '../utils/teamVisibility';
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
// Hard-delete list #6: a disbanded team answers 410 on every route below that
// carries refuseDisbandedTeam. Left open: the team page (it says whether you
// were a member), the three expense READS (former members keep the history),
// and withdrawing your own pending join request.
// SC-275: Team insights (PREMIUM + member-gated inside the handler). Additive.
router.get('/:id/insights', authenticateToken, refuseDisbandedTeam, getTeamInsights);
router.post('/:id/members', authenticateToken, refuseDisbandedTeam, refuseEntryTeam, addTeamMember);
router.delete('/:id/members/:userId', authenticateToken, refuseDisbandedTeam, refuseEntryTeam, removeTeamMember);
// SC-359 · removed-member (ban) visibility + undo. Managers only.
router.get('/:id/bans', authenticateToken, refuseDisbandedTeam, listTeamBans);
router.delete('/:id/bans/:userId', authenticateToken, refuseDisbandedTeam, unbanTeamMember);
router.patch('/:id/members/:userId/role', authenticateToken, refuseDisbandedTeam, refuseEntryTeam, updateMemberRole);
router.patch('/:id', authenticateToken, refuseDisbandedTeam, refuseEntryTeam, updateTeam);
router.delete('/:id', authenticateToken, refuseDisbandedTeam, refuseEntryTeam, disbandTeam);
router.post('/:id/join-requests', authenticateToken, refuseDisbandedTeam, refuseEntryTeam, requestToJoin);
router.get('/:id/join-requests', authenticateToken, refuseDisbandedTeam, listJoinRequests);
router.patch('/:id/join-requests/:userId', authenticateToken, refuseDisbandedTeam, refuseEntryTeam, decideJoinRequest);
router.delete('/:id/join-requests/me', authenticateToken, withdrawJoinRequest);
router.get('/:id/expenses', authenticateToken, listExpenses);
router.get('/:id/expenses/summary', authenticateToken, getExpenseSummary);
// SC-361: read-only by design — the audit trail has no write route, and the
// table is append-only in the database too (migration 077).
router.get('/:id/expenses/log', authenticateToken, listExpenseLog);
router.post('/:id/expenses', authenticateToken, refuseDisbandedTeam, addExpense);
router.patch('/:id/expenses/:expenseId', authenticateToken, refuseDisbandedTeam, updateExpense);
router.delete('/:id/expenses/:expenseId', authenticateToken, refuseDisbandedTeam, deleteExpense);

export default router;
