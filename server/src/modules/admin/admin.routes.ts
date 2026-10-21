import { Router } from 'express';
import { z } from 'zod';
import { paginationSchema } from '../../lib/pagination.js';
import { validate } from '../../lib/validate.js';
import { getAuth, requireRole } from '../../middleware/auth.js';
import { displayNameSchema, emailSchema, passwordSchema, usernameSchema } from '../auth/auth.schemas.js';
import { listDisputes, listDisputesQuery, resolveDispute, resolveDisputeSchema } from '../disputes/dispute.service.js';
import { createAssignedMatchSchema, listMatchesQuery } from '../matches/match.schemas.js';
import { createAssignedMatch, listMatches } from '../matches/match.service.js';
import { settingsSchema, getSettings, updateSettings } from '../settings/settings.service.js';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { sensitiveLimiter } from '../../middleware/rateLimit.js';
import { mailFrom, mailProvider, renderEmail, sendMail } from '../../services/mail.js';
import { audit } from '../audit/audit.service.js';
import * as admin from './admin.service.js';

export const adminRouter = Router();
adminRouter.use(requireRole('ADMIN'));

const idParam = (raw: unknown) => validate(z.object({ id: z.string().min(1).max(40) }), raw).id;

adminRouter.get('/overview', async (_req, res) => {
  res.json({ data: await admin.overview() });
});

const userQuery = z.object({
  search: z.string().trim().max(254).optional(),
  role: z.enum(['ADMIN', 'COORDINATOR', 'PLAYER']).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DISABLED']).optional(),
  sort: z.enum(['createdAt', 'lastLoginAt', 'username']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

adminRouter.get('/users', async (req, res) => {
  const { items, meta } = await admin.listUsers(validate(userQuery, req.query), validate(paginationSchema, req.query));
  res.json({ data: items, meta });
});

adminRouter.get('/users/:id', async (req, res) => {
  res.json({ data: await admin.userDetail(idParam(req.params)) });
});

adminRouter.post('/coordinators', async (req, res) => {
  const input = validate(
    z.object({ displayName: displayNameSchema, username: usernameSchema, email: emailSchema, password: passwordSchema }).strict(),
    req.body,
  );
  res.status(201).json({ data: await admin.createCoordinator(getAuth(req).user, input) });
});

adminRouter.post('/users', async (req, res) => {
  const input = validate(
    z
      .object({
        displayName: displayNameSchema,
        username: usernameSchema,
        email: emailSchema,
        password: passwordSchema,
        role: z.enum(['PLAYER', 'COORDINATOR', 'ADMIN']).default('PLAYER'),
      })
      .strict(),
    req.body,
  );
  res.status(201).json({ data: await admin.createUser(getAuth(req).user, input) });
});

adminRouter.delete('/users/:id', async (req, res) => {
  const { reason } = validate(z.object({ reason: z.string().trim().min(3).max(500) }).strict(), req.body);
  res.json({ data: await admin.removeUser(getAuth(req).user, idParam(req.params), reason) });
});

/** Create a game room between two players (tournament optional for admins). */
adminRouter.post('/matches', async (req, res) => {
  const input = validate(createAssignedMatchSchema, req.body);
  const match = await createAssignedMatch(getAuth(req).user, input);
  res.status(201).json({ data: { id: match.id, status: match.status } });
});

adminRouter.patch('/users/:id/role', async (req, res) => {
  const { role } = validate(z.object({ role: z.enum(['ADMIN', 'COORDINATOR', 'PLAYER']) }).strict(), req.body);
  res.json({ data: await admin.changeRole(getAuth(req).user, idParam(req.params), role) });
});

adminRouter.patch('/users/:id/status', async (req, res) => {
  const { status, reason } = validate(
    z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'DISABLED']), reason: z.string().trim().min(3).max(500) }).strict(),
    req.body,
  );
  res.json({ data: await admin.changeStatus(getAuth(req).user, idParam(req.params), status, reason) });
});

adminRouter.post('/users/:id/password-reset', async (req, res) => {
  const result = await admin.initiatePasswordReset(getAuth(req).user, idParam(req.params));
  res.json({ data: { ok: true, ...result } });
});

/** Which email provider is active (no secrets returned). */
adminRouter.get('/email/status', (_req, res) => {
  const provider = mailProvider();
  res.json({
    data: {
      provider,
      configured: provider !== 'none',
      from: mailFrom().formatted,
      smtpHost: provider === 'smtp' ? env.SMTP_HOST : null,
      verificationRequired: env.REQUIRE_EMAIL_VERIFICATION && provider !== 'none',
    },
  });
});

/** Sends a test email so the admin can confirm delivery works end to end. */
adminRouter.post('/email/test', sensitiveLimiter, async (req, res) => {
  const { to } = validate(z.object({ to: emailSchema }).strict(), req.body);
  const result = await sendMail({
    to,
    subject: 'ChessArena test email',
    text: `This is a test email from ChessArena.\n\nIf you can read this, password-reset emails will be delivered.\n\nISTA presents ChessArena for i++'26`,
    html: renderEmail({
      heading: 'Your email setup works 🎃',
      paragraphs: ['This is a test email from the ChessArena admin portal.', 'If you can read this, password-reset emails will be delivered.'],
    }),
  });
  await audit({ actorId: getAuth(req).user.id, action: 'admin.email_test', resourceType: 'settings', details: { ok: result.ok, provider: result.provider } });
  if (!result.ok) throw new AppError('BAD_REQUEST', `Sending failed (${result.provider}): ${result.error}`);
  res.json({ data: { ok: true, provider: result.provider } });
});

adminRouter.get('/matches', async (req, res) => {
  const q = validate(listMatchesQuery, req.query);
  const { items, meta } = await listMatches(getAuth(req).user, { ...q, scope: 'mine' }, validate(paginationSchema, req.query));
  res.json({ data: items, meta });
});

adminRouter.get('/audit-logs', async (req, res) => {
  const q = validate(
    z.object({
      action: z.string().trim().max(64).optional(),
      resourceType: z.string().trim().max(32).optional(),
      resourceId: z.string().trim().max(64).optional(),
      actorId: z.string().trim().max(40).optional(),
    }),
    req.query,
  );
  const { items, meta } = await admin.listAudit(q, validate(paginationSchema, req.query));
  res.json({ data: items, meta });
});

adminRouter.get('/disputes', async (req, res) => {
  const { status } = validate(listDisputesQuery, req.query);
  const { items, meta } = await listDisputes(getAuth(req).user, status, validate(paginationSchema, req.query));
  res.json({ data: items, meta });
});

adminRouter.post('/disputes/:id/resolve', async (req, res) => {
  const input = validate(resolveDisputeSchema, req.body);
  res.json({ data: await resolveDispute(getAuth(req).user, idParam(req.params), input) });
});

adminRouter.get('/settings', async (_req, res) => {
  res.json({ data: await getSettings() });
});

adminRouter.patch('/settings', async (req, res) => {
  const patch = validate(settingsSchema.partial().strict(), req.body);
  res.json({ data: await updateSettings(getAuth(req).user.id, patch) });
});
