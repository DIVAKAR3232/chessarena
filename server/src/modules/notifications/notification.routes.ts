import { Router } from 'express';
import { z } from 'zod';
import { pageMeta, paginationSchema, toSkipTake } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import { validate } from '../../lib/validate.js';
import { getAuth, requireAuth } from '../../middleware/auth.js';

export const notificationRouter = Router();
notificationRouter.use(requireAuth);

notificationRouter.get('/', async (req, res) => {
  const page = validate(paginationSchema, req.query);
  const { unread } = validate(z.object({ unread: z.enum(['true', 'false']).optional() }), req.query);
  const where = { recipientId: getAuth(req).user.id, ...(unread === 'true' ? { readAt: null } : {}) };
  const [total, items, unreadCount] = await prisma.$transaction([
    prisma.notification.count({ where }),
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, ...toSkipTake(page) }),
    prisma.notification.count({ where: { recipientId: getAuth(req).user.id, readAt: null } }),
  ]);
  res.json({ data: items, meta: { ...pageMeta(page, total), unreadCount } });
});

notificationRouter.get('/unread-count', async (req, res) => {
  const count = await prisma.notification.count({ where: { recipientId: getAuth(req).user.id, readAt: null } });
  res.json({ data: { count } });
});

notificationRouter.post('/read-all', async (req, res) => {
  await prisma.notification.updateMany({
    where: { recipientId: getAuth(req).user.id, readAt: null },
    data: { readAt: new Date() },
  });
  res.json({ data: { ok: true } });
});

notificationRouter.post('/:id/read', async (req, res) => {
  const { id } = validate(z.object({ id: z.string().min(1).max(40) }), req.params);
  // Scoped to the recipient so nobody can mark another user's notifications.
  await prisma.notification.updateMany({
    where: { id, recipientId: getAuth(req).user.id, readAt: null },
    data: { readAt: new Date() },
  });
  res.json({ data: { ok: true } });
});
