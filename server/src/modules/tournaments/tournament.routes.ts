import { Router } from 'express';
import { z } from 'zod';
import { paginationSchema } from '../../lib/pagination.js';
import { validate } from '../../lib/validate.js';
import { getAuth, requireAuth, requireRole } from '../../middleware/auth.js';
import * as svc from './tournament.service.js';

export const tournamentRouter = Router();

const idParam = (raw: unknown) => validate(z.object({ id: z.string().min(1).max(40) }), raw).id;
const viewer = (req: { auth?: { user: { id: string; role: 'ADMIN' | 'COORDINATOR' | 'PLAYER'; displayName: string } } }) =>
  req.auth?.user ?? null;

// Public reads (DRAFT tournaments are hidden unless the viewer manages them).
tournamentRouter.get('/', async (req, res) => {
  const q = validate(svc.listTournamentsQuery, req.query);
  const page = validate(paginationSchema, req.query);
  const { items, meta } = await svc.listTournaments(viewer(req), q, page);
  res.json({ data: items, meta });
});

tournamentRouter.get('/:id', async (req, res) => {
  res.json({ data: await svc.getTournament(viewer(req), idParam(req.params)) });
});

tournamentRouter.get('/:id/participants', async (req, res) => {
  res.json({ data: await svc.listParticipants(viewer(req), idParam(req.params)) });
});

tournamentRouter.get('/:id/standings', async (req, res) => {
  res.json({ data: await svc.standings(viewer(req), idParam(req.params)) });
});

tournamentRouter.get('/:id/rounds', async (req, res) => {
  res.json({ data: await svc.listRounds(viewer(req), idParam(req.params)) });
});

tournamentRouter.get('/:id/announcements', async (req, res) => {
  res.json({ data: await svc.listAnnouncements(viewer(req), idParam(req.params)) });
});

// Management
tournamentRouter.post('/', requireRole('ADMIN'), async (req, res) => {
  const input = validate(svc.createTournamentSchema, req.body);
  res.status(201).json({ data: await svc.createTournament(getAuth(req).user, input) });
});

tournamentRouter.patch('/:id', requireRole('ADMIN', 'COORDINATOR'), async (req, res) => {
  const input = validate(svc.updateTournamentSchema, req.body);
  res.json({ data: await svc.updateTournament(getAuth(req).user, idParam(req.params), input) });
});

tournamentRouter.post('/:id/status', requireRole('ADMIN', 'COORDINATOR'), async (req, res) => {
  const { status, reason } = validate(svc.transitionSchema, req.body);
  res.json({ data: await svc.transitionTournament(getAuth(req).user, idParam(req.params), status, reason) });
});

tournamentRouter.put('/:id/coordinators', requireRole('ADMIN'), async (req, res) => {
  const { coordinatorIds } = validate(z.object({ coordinatorIds: z.array(z.string().min(1).max(40)).max(10) }).strict(), req.body);
  await svc.setCoordinators(getAuth(req).user, idParam(req.params), coordinatorIds);
  res.json({ data: { ok: true } });
});

tournamentRouter.post('/:id/register', requireRole('PLAYER'), async (req, res) => {
  await svc.register(getAuth(req).user, idParam(req.params));
  res.status(201).json({ data: { ok: true } });
});

tournamentRouter.delete('/:id/register', requireRole('PLAYER'), async (req, res) => {
  await svc.withdraw(getAuth(req).user, idParam(req.params));
  res.json({ data: { ok: true } });
});

tournamentRouter.post('/:id/participants', requireRole('ADMIN', 'COORDINATOR'), async (req, res) => {
  const { playerId } = validate(z.object({ playerId: z.string().min(1).max(40) }).strict(), req.body);
  await svc.addParticipant(getAuth(req).user, idParam(req.params), playerId);
  res.status(201).json({ data: { ok: true } });
});

tournamentRouter.delete('/:id/participants/:playerId', requireRole('ADMIN', 'COORDINATOR'), async (req, res) => {
  const { playerId } = validate(z.object({ id: z.string(), playerId: z.string().min(1).max(40) }), req.params);
  const { reason } = validate(z.object({ reason: z.string().trim().min(3).max(500) }).strict(), req.body);
  await svc.removeParticipant(getAuth(req).user, idParam(req.params), playerId, reason);
  res.json({ data: { ok: true } });
});

tournamentRouter.post('/:id/rounds', requireRole('ADMIN', 'COORDINATOR'), async (req, res) => {
  res.status(201).json({ data: await svc.generateNextRound(getAuth(req).user, idParam(req.params)) });
});

tournamentRouter.post('/:id/announcements', requireAuth, requireRole('ADMIN', 'COORDINATOR'), async (req, res) => {
  const input = validate(svc.announcementSchema, req.body);
  res.status(201).json({ data: await svc.createAnnouncement(getAuth(req).user, idParam(req.params), input) });
});
