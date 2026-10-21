import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().url(),
  TEST_DATABASE_URL: z.string().url().optional(),
  CLIENT_ORIGIN: z
    .string()
    .min(1)
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim().replace(/\/$/, ''))
        .filter(Boolean),
    ),
  APP_URL: z.string().url().default('http://localhost:5173'),
  /** Serve the built web client (client/dist) from this server: single-host deployment. */
  SERVE_CLIENT: z
    .enum(['true', 'false', '1', '0', ''])
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
  JWT_SOCKET_SECRET: z.string().min(32, 'must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(60).default(7),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_DOMAIN: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
  RECONNECT_GRACE_MS: z.coerce.number().int().min(1000).max(600000).default(60000),
  INVITATION_TTL_MINUTES: z.coerce.number().int().min(1).max(10080).default(60),
  // ---- Email (password resets, verification) ----
  /** Sender shown to recipients, e.g. "ISTA ChessArena <someone@gmail.com>". */
  MAIL_FROM: z.string().optional(),
  /** Brevo HTTP API key (works on hosts that block SMTP, e.g. Render's free plan). Preferred when set. */
  BREVO_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  /** Legacy name for MAIL_FROM. */
  SMTP_FROM: z.string().optional(),
  /** Require new players to verify their email before signing in (needs working email). */
  REQUIRE_EMAIL_VERIFICATION: z
    .enum(['true', 'false', '1', '0', ''])
    .optional()
    .transform((v) => v === 'true' || v === '1'),
});

// On Render the public URL is provided automatically; use it unless configured explicitly.
const input: Record<string, string | undefined> = { ...process.env };
const external = process.env.RENDER_EXTERNAL_URL?.replace(/\/$/, '');
if (external) {
  input.CLIENT_ORIGIN ||= external;
  input.APP_URL ||= external;
}

const parsed = schema.safeParse(input);
if (!parsed.success) {
  // Never print values: they may contain secrets.
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

const data = parsed.data;
if (data.NODE_ENV === 'production') {
  for (const key of ['JWT_ACCESS_SECRET', 'JWT_SOCKET_SECRET'] as const) {
    if (data[key].startsWith('change-me')) {
      console.error(`${key} still has the placeholder value; refusing to start in production.`);
      process.exit(1);
    }
  }
  if (data.JWT_ACCESS_SECRET === data.JWT_SOCKET_SECRET) {
    console.error('JWT_ACCESS_SECRET and JWT_SOCKET_SECRET must differ.');
    process.exit(1);
  }
}

export const env = {
  ...data,
  isProduction: data.NODE_ENV === 'production',
  isTest: data.NODE_ENV === 'test',
};
export type Env = typeof env;
