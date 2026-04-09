import 'dotenv/config';

import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import authRoutes from './routes/auth.routes';
import citiesRoutes from './routes/cities.routes';
import sportsRoutes from './routes/sports.routes';
import usersRoutes from './routes/users.routes';
import notificationsRoutes from './routes/notifications.routes';
import uploadsRoutes from './routes/uploads.routes';
import appRoutes from './routes/app.routes';
import invitesRoutes from './routes/invites.routes';
import servicesRoutes from './routes/services.routes';
import teamsRoutes from './routes/teams.routes';
import tournamentsRoutes from './routes/tournaments.routes';
import matchesRoutes from './routes/matches.routes';
import scoringRoutes from './routes/scoring.routes';
import leaderboardRoutes from './routes/leaderboard.routes';

const app = express();
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors());
// 12mb cap supports base64-encoded profile photos (Change #4: no client size limit;
// server compresses). Larger uploads should switch to multipart in a future module.
app.use(express.json({ limit: '12mb' }));

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const sendOtpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

app.get('/', (_req: Request, res: Response) => {
  res.json({ ok: true, service: 'sportclan-backend' });
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// Stricter limit on /auth/send-otp must be mounted BEFORE the general /auth limiter
app.use('/auth/send-otp', sendOtpLimiter);
app.use('/auth', authLimiter, authRoutes);
app.use('/cities', citiesRoutes);
app.use('/sports', sportsRoutes);
app.use('/users', usersRoutes);
app.use('/notifications', notificationsRoutes);
app.use('/uploads', uploadsRoutes);
app.use('/app', appRoutes);
app.use('/invites', invitesRoutes);
app.use('/services', servicesRoutes);
app.use('/teams', teamsRoutes);
app.use('/tournaments', tournamentsRoutes);
app.use('/matches', matchesRoutes);
app.use('/scoring', scoringRoutes);
app.use('/leaderboard', leaderboardRoutes);

const PORT = parseInt(process.env.PORT || '4000', 10);
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[sportclan-backend] listening on :${PORT}`);
});
