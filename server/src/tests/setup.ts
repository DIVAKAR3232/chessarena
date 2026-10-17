// Runs before every test file. Points Prisma at the dedicated test database.
import 'dotenv/config';

process.env.NODE_ENV = 'test';
if (!process.env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL must be set to run the test suite (it will be wiped).');
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.RECONNECT_GRACE_MS = '1500';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';
// Tests assume no SMTP (no email verification step).
process.env.SMTP_HOST = '';
