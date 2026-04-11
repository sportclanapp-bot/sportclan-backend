// ════════════════════════════════════════════════════════════════════════════
// ⚠️  REMOVE BEFORE PRODUCTION LAUNCH ⚠️
//
// This router mounts /dev/load-test-data which seeds 50 users, 22 teams,
// 55 tournaments, ~385 matches, etc. It is authenticated but anyone with a
// valid JWT can trigger it. For the final Play Store / App Store submission:
//   1. Delete this file and src/controllers/dev.controller.ts
//   2. Remove the `import devRoutes` and `app.use('/dev', devRoutes)` lines
//      from src/index.ts
//   3. Remove the "Load Test Data" button from HamburgerMenuScreen.tsx
//      (frontend already gates it behind __DEV__ but strip it entirely).
// ════════════════════════════════════════════════════════════════════════════
import { Router } from 'express';
import { loadTestData } from '../controllers/dev.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

router.post('/load-test-data', authenticateToken, loadTestData);

export default router;
