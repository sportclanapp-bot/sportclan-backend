import { Router } from 'express';
import { searchVenues, getVenue, createVenue, updateVenue, deleteVenue } from '../controllers/venues.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

router.get('/', authenticateToken, searchVenues);
router.get('/:id', authenticateToken, getVenue); // Profile & Settings tidy-up: a venue's own page
router.post('/', authenticateToken, createVenue);
router.patch('/:id', authenticateToken, updateVenue); // decision 7: creator or admin
router.delete('/:id', authenticateToken, deleteVenue); // decision 7: soft, creator or admin

export default router;
