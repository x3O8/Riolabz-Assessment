import mongoose from 'mongoose';
import pino from 'pino';
import { createApp } from './app.js';
import { connectDatabase } from './config/database.js';
import { readConfig } from './config/env.js';

let logger = pino();
try {
  const config = readConfig();
  logger = pino({ level: config.LOG_LEVEL });
  await connectDatabase(config.MONGODB_URI);
  const server = createApp(config, logger).listen(config.PORT, config.HOST, () =>
    logger.info({ host: config.HOST, port: config.PORT }, 'API listening'));

  server.on('error', async error => {
    logger.fatal({ name: error.name, code: error.code }, 'HTTP server failed');
    process.exitCode = 1;
    await mongoose.disconnect();
  });

  const shutdown = signal => {
    logger.info({ signal }, 'Shutting down');
    const timeout = setTimeout(() => process.exit(1), 10_000);
    timeout.unref();
    server.close(async error => {
      try {
        await mongoose.disconnect();
        if (error) process.exitCode = 1;
      } catch {
        process.exitCode = 1;
      } finally {
        clearTimeout(timeout);
      }
    });
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
} catch (error) {
  logger.fatal({
    name: error.name,
    code: error.code,
    reason: error.message.startsWith('Invalid configuration') || error.message.startsWith('MongoDB must')
      ? error.message : undefined,
  }, 'API startup failed');
  process.exitCode = 1;
}
