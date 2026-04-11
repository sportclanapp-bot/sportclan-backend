import { Router } from 'express';
import { searchVenues, createVenue } from '../controllers/venues.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

router.get('/', authenticateToken, searchVenues);
router.post('/', authenticateToken, createVenue);

export default router;
