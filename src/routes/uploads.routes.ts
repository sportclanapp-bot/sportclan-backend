import { Router } from 'express';
import { uploadProfilePhoto, uploadAudio } from '../controllers/uploads.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

router.post('/profile-photo', authenticateToken, uploadProfilePhoto);
router.post('/audio', authenticateToken, uploadAudio);

export default router;
