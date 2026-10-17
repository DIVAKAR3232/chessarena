/**
 * Sets the administrator login (username + password). Used by `./startup.sh --admin`.
 *
 *   ADMIN_USERNAME=... ADMIN_PASSWORD=... [ADMIN_EMAIL=...] npm run admin:set
 *
 * - If an ADMIN with that username exists, its password is replaced and all its sessions end.
 * - If no account has that username, a new ADMIN is created.
 * - If the username belongs to a player or coordinator, the script refuses (no silent promotion).
 * The password is never printed or logged.
 */
import { prisma } from '../lib/prisma.js';
import { audit } from '../modules/audit/audit.service.js';
import { emailSchema, passwordSchema, usernameSchema } from '../modules/auth/auth.schemas.js';
import { hashPassword } from '../modules/auth/password.js';

async function main() {
  const username = usernameSchema.safeParse(process.env.ADMIN_USERNAME ?? '');
  const password = passwordSchema.safeParse(process.env.ADMIN_PASSWORD ?? '');
  if (!username.success) {
    console.error('Invalid username: 3-32 characters, letters, numbers and underscores only.');
    process.exit(1);
  }
  if (!password.success) {
    console.error(`Invalid password: ${password.error.issues.map((i) => i.message).join('; ')}`);
    process.exit(1);
  }
  const passwordHash = await hashPassword(password.data);
  const existing = await prisma.user.findUnique({ where: { username: username.data }, select: { id: true, role: true } });

  if (existing && existing.role !== 'ADMIN') {
    console.error(`"${username.data}" is a ${existing.role.toLowerCase()} account. Choose a different admin username.`);
    process.exit(1);
  }

  if (existing) {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: existing.id }, data: { passwordHash, accountStatus: 'ACTIVE' } });
      await tx.session.updateMany({ where: { userId: existing.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await audit({ actorId: null, action: 'bootstrap.admin_password_set', resourceType: 'user', resourceId: existing.id }, tx);
    });
    console.log(`Password updated for admin "${username.data}".`);
    return;
  }

  const email = emailSchema.safeParse(process.env.ADMIN_EMAIL || `${username.data}@chessarena.local`);
  if (!email.success) {
    console.error('Invalid ADMIN_EMAIL.');
    process.exit(1);
  }
  const taken = await prisma.user.findUnique({ where: { email: email.data }, select: { id: true } });
  if (taken) {
    console.error(`The email ${email.data} is already used by another account. Set ADMIN_EMAIL to a different address.`);
    process.exit(1);
  }
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: { username: username.data, displayName: username.data, email: email.data, passwordHash, role: 'ADMIN', emailVerifiedAt: new Date() },
    });
    await audit({ actorId: null, action: 'bootstrap.create_admin', resourceType: 'user', resourceId: u.id }, tx);
    return u;
  });
  console.log(`Created admin "${user.username}".`);
}

main()
  .catch((err) => {
    console.error('Failed to set admin:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
