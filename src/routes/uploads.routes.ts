import { Router } from 'express';
import { uploadProfilePhoto } from '../controllers/uploads.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

router.post('/profile-photo', authenticateToken, uploadProfilePhoto);

export default router;
