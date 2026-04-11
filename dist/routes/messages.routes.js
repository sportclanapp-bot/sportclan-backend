"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const messages_controller_1 = require("../controllers/messages.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
// All message routes require auth
router.use(auth_middleware_1.authenticateToken);
// Chats
router.get('/chats', messages_controller_1.listChats);
router.post('/dm', messages_controller_1.getOrCreateDM);
// Groups
router.post('/groups', messages_controller_1.createGroup);
router.patch('/groups/:id', messages_controller_1.updateGroup);
router.post('/groups/:id/members', messages_controller_1.addMember);
router.delete('/groups/:id/members/:memberId', messages_controller_1.removeMember);
router.post('/groups/:id/members/:memberId/promote', messages_controller_1.promoteMember);
router.post('/groups/:id/leave', messages_controller_1.leaveGroup);
router.delete('/groups/:id', messages_controller_1.deleteGroup);
router.get('/groups/:id/members', messages_controller_1.getGroupMembers);
// Messages
router.get('/chats/:id/messages', messages_controller_1.getMessages);
router.post('/chats/:id/messages', messages_controller_1.sendMessage);
router.post('/chats/:id/read', messages_controller_1.markAsRead);
router.post('/read', messages_controller_1.batchMarkRead);
router.delete('/messages/:messageId', messages_controller_1.deleteMessage);
router.post('/forward', messages_controller_1.forwardMessage);
exports.default = router;
//# sourceMappingURL=messages.routes.js.map