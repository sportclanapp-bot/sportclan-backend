import { Router } from 'express';
import {
  listChats, getOrCreateDM, createGroup, updateGroup,
  addMember, removeMember, promoteMember, leaveGroup, deleteGroup,
  getMessages, sendMessage, deleteMessage, forwardMessage,
  markAsRead, getGroupMembers, batchMarkRead, reactToMessage,
} from '../controllers/messages.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

// All message routes require auth
router.use(authenticateToken);

// Chats
router.get('/chats', listChats);
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
router.post('/read', batchMarkRead);
router.delete('/messages/:messageId', deleteMessage);
router.patch('/messages/:messageId/react', reactToMessage);
router.post('/forward', forwardMessage);

export default router;
