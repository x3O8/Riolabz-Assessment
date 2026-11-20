import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  MONGODB_URI: z.string().regex(/^mongodb(?:\+srv)?:\/\//),
  JWT_SECRET: z.string().min(32),
  JWT_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(3600),
  AUTH_RATE_LIMIT: z.coerce.number().int().positive().default(20),
  API_RATE_LIMIT: z.coerce.number().int().positive().default(300),
  TRUST_PROXY_HOPS: z.coerce.number().int().nonnegative().default(0),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export function readConfig(env = process.env) {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const fields = result.error.issues.map(issue => issue.path.join('.'));
    throw new Error(`Invalid configuration fields: ${fields.join(', ')}`);
  }
  return result.data;
}
