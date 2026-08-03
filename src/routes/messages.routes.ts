import { Router } from 'express';
import { guardIdParams } from '../middleware/uuidParams.middleware';
import {
  listChats, getOrCreateDM, createGroup, updateGroup,
  addMember, removeMember, promoteMember, leaveGroup, deleteGroup,
  getMessages, sendMessage, deleteMessage, forwardMessage,
  markAsRead, setTyping, getGroupMembers, batchMarkRead, reactToMessage,
  getUnreadCount,
} from '../controllers/messages.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();
// SC-397: 400 on a malformed id instead of letting it reach Postgres and 500.
guardIdParams(router);

// All message routes require auth
router.use(authenticateToken);

// Chats
router.get('/chats', listChats);
// SC-349: total unread across ALL chats (Home header 💬 dot). Declared before the
// /chats/:id routes — it is a sibling path, but keeping the flat routes together
// makes the ordering obvious.
router.get('/unread-count', getUnreadCount);
router.post('/dm', getOrCreateDM);

// Groups
router.post('/groups', createGroup);
router.patch('/groups/:id', updateGroup);
router.post('/groups/:id/members', addMember);
router.delete('/groups/:id/members/:memberId', removeMember);
router.post('/groups/:id/members/:memberId/promote', promoteMember);
router.post('/groups/:id/leave', leaveGroup);
router.delete('/groups/:id', deleteGroup);
router.get('/groups/:id/members', getGroupMembers);

// Messages
router.get('/chats/:id/messages', getMessages);
router.post('/chats/:id/messages', sendMessage);
router.post('/chats/:id/read', markAsRead);
router.post('/chats/:id/typing', setTyping); // SC-344 real typing signal
router.post('/read', batchMarkRead);
router.delete('/messages/:messageId', deleteMessage);
router.patch('/messages/:messageId/react', reactToMessage);
router.post('/forward', forwardMessage);

export default router;
