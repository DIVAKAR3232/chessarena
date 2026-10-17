/**
 * One-time, idempotent administrator bootstrap (there is deliberately no HTTP endpoint for this).
 *
 *   ADMIN_EMAIL=... ADMIN_USERNAME=... ADMIN_PASSWORD=... npm run admin:create
 *
 * - If no account with that email/username exists, an ACTIVE, email-verified ADMIN is created.
 * - If the account exists and is already an admin, nothing changes (safe to re-run).
 * - If it exists with another role, the script refuses unless --promote is passed.
 * The password is never printed or logged.
 */
import { prisma } from '../lib/prisma.js';
import { audit } from '../modules/audit/audit.service.js';
import { emailSchema, passwordSchema, usernameSchema } from '../modules/auth/auth.schemas.js';
import { hashPassword } from '../modules/auth/password.js';

async function main() {
  const promote = process.argv.includes('--promote');
  // --if-configured (used at deploy start-up): silently skip when no credentials are provided.
  const optional = process.argv.includes('--if-configured');
  if (optional && (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD)) {
    console.log('Admin bootstrap skipped (ADMIN_USERNAME / ADMIN_PASSWORD not set).');
    return;
  }
  const username = usernameSchema.safeParse(process.env.ADMIN_USERNAME ?? '');
  const email = emailSchema.safeParse(process.env.ADMIN_EMAIL || `${username.success ? username.data : 'admin'}@chessarena.local`);
  const password = passwordSchema.safeParse(process.env.ADMIN_PASSWORD ?? '');
  if (!email.success || !username.success || !password.success) {
    console.error('Set valid ADMIN_USERNAME and ADMIN_PASSWORD (8+ chars with a letter and a number); ADMIN_EMAIL is optional.');
    process.exit(1);
  }
  if (optional) {
    const admins = await prisma.user.count({ where: { role: 'ADMIN' } });
    if (admins > 0) {
      console.log('Admin bootstrap skipped: an administrator already exists.');
      return;
    }
  }

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: email.data }, { username: username.data }] },
    select: { id: true, role: true, email: true, username: true },
  });

  if (existing) {
    if (existing.role === 'ADMIN') {
      console.log(`Admin "${existing.username}" already exists; nothing to do.`);
      return;
    }
    if (!promote) {
      console.error(`An account "${existing.username}" exists with role ${existing.role}. Re-run with --promote to make it an admin.`);
      process.exit(1);
    }
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: existing.id }, data: { role: 'ADMIN', accountStatus: 'ACTIVE' } });
      await tx.session.updateMany({ where: { userId: existing.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await audit({ actorId: null, action: 'bootstrap.promote_admin', resourceType: 'user', resourceId: existing.id }, tx);
    });
    console.log(`Promoted "${existing.username}" to admin.`);
    return;
  }

  const passwordHash = await hashPassword(password.data);
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        email: email.data,
        username: username.data,
        displayName: username.data,
        passwordHash,
        role: 'ADMIN',
        emailVerifiedAt: new Date(),
      },
    });
    await audit({ actorId: null, action: 'bootstrap.create_admin', resourceType: 'user', resourceId: u.id }, tx);
    return u;
  });
  console.log(`Created admin "${user.username}". Remove ADMIN_PASSWORD from the environment now.`);
}

main()
  .catch((err) => {
    console.error('Failed to create admin:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
