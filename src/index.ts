import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import authRoutes from './routes/auth.routes';
import citiesRoutes from './routes/cities.routes';
import sportsRoutes from './routes/sports.routes';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));

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

const PORT = parseInt(process.env.PORT || '4000', 10);
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[sportclan-backend] listening on :${PORT}`);
});
