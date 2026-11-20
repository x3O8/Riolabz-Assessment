import { randomUUID } from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { errorHandler, unknownRoute } from './middleware/errors.js';
import { apiRoutes } from './routes/index.js';

function limiter(limit, windowMs) {
  return rateLimit({
    windowMs, limit, standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (req, res) => res.status(429).json({
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.', requestId: req.id },
    }),
  });
}

export function createApp(config, logger = pino({ level: config.LOG_LEVEL })) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY_HOPS || false);
  app.use(pinoHttp({
    logger,
    genReqId: (_req, res) => {
      const id = randomUUID();
      res.setHeader('X-Request-Id', id);
      return id;
    },
    serializers: {
      req: ({ id, method, url }) => ({ id, method, path: url?.split('?')[0] }),
    },
  }));
  app.use(helmet());
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/v1', limiter(config.API_RATE_LIMIT, 60_000), express.json({ limit: '64kb' }),
    apiRoutes(config, limiter(config.AUTH_RATE_LIMIT, 15 * 60_000)));
  app.use(unknownRoute);
  app.use(errorHandler);
  return app;
}
