import 'dotenv/config';

import path from 'path';
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
import communityRoutes from './routes/community.routes';
import messagesRoutes from './routes/messages.routes';
import searchRoutes from './routes/search.routes';
import availabilityRoutes from './routes/availability.routes';
import subscriptionsRoutes from './routes/subscriptions.routes';
import giftsRoutes from './routes/gifts.routes';
import transactionsRoutes from './routes/transactions.routes';
import accountRoutes from './routes/account.routes';
import webhooksRoutes from './routes/webhooks.routes';
import badgesRoutes from './routes/badges.routes';
import challengesRoutes from './routes/challenges.routes';
import seasonsRoutes from './routes/seasons.routes';
import kudosRoutes from './routes/kudos.routes';
import venuesRoutes from './routes/venues.routes';

const app = express();
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
}));
app.use(cors());
app.use(express.static(path.join(__dirname, '..', 'public')));
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
app.use('/community', communityRoutes);
app.use('/messages', messagesRoutes);
app.use('/search', searchRoutes);
app.use('/availability', availabilityRoutes);
app.use('/subscriptions', subscriptionsRoutes);
app.use('/gifts', giftsRoutes);
app.use('/transactions', transactionsRoutes);
app.use('/account', accountRoutes);
app.use('/webhooks', webhooksRoutes);
app.use('/badges', badgesRoutes);
app.use('/challenges', challengesRoutes);
app.use('/seasons', seasonsRoutes);
app.use('/kudos', kudosRoutes);
app.use('/venues', venuesRoutes);

const PORT = parseInt(process.env.PORT || '4000', 10);
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[sportclan-backend] listening on :${PORT}`);
  // Payment webhook HMAC verification silently 500s every hit without this —
  // surface it loudly at boot so it's impossible to ship without noticing.
  if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
    // eslint-disable-next-line no-console
    console.warn(
      '[sportclan-backend] \u26A0\uFE0F  RAZORPAY_WEBHOOK_SECRET is not set. ' +
      'Razorpay webhook signature verification will fail. ' +
      'Add it to the hosting provider env (Render/Railway) before launch.',
    );
  }
});
// Sat Apr 11 01:56:26 IST 2026
