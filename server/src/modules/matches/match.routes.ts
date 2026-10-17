import { Router } from 'express';
import { getAuth, requireAuth, requireRole } from '../../middleware/auth.js';
import { paginationSchema } from '../../lib/pagination.js';
import { validate } from '../../lib/validate.js';
import { z } from 'zod';
import { submitDispute } from '../disputes/dispute.service.js';
import * as gameplay from './gameplay.service.js';
import {
  cancelSchema,
  createChallengeSchema,
  disputeSchema,
  inviteSchema,
  listMatchesQuery,
  notesSchema,
  queueSchema,
} from './match.schemas.js';
import * as matches from './match.service.js';

export const matchRouter = Router();
matchRouter.use(requireAuth);

const idParam = (raw: unknown) => validate(z.object({ id: z.string().min(1).max(40) }), raw).id;

matchRouter.get('/', async (req, res) => {
  const q = validate(listMatchesQuery, req.query);
  const page = validate(paginationSchema, req.query);
  const { items, meta } = await matches.listMatches(getAuth(req).user, q, page);
  res.json({ data: items, meta });
});

matchRouter.post('/', requireRole('PLAYER'), async (req, res) => {
  const input = validate(createChallengeSchema, req.body);
  const match = await matches.createChallenge(getAuth(req).user, input);
  res.status(201).json({ data: { id: match.id, status: match.status } });
});

matchRouter.get('/invitations', async (req, res) => {
  res.json({ data: await matches.listInvitations(getAuth(req).user) });
});

matchRouter.post('/invitations/:id/accept', requireRole('PLAYER'), async (req, res) => {
  const match = await matches.respondToInvitation(getAuth(req).user, idParam(req.params), true);
  res.json({ data: { matchId: match.id, status: match.status } });
});

matchRouter.post('/invitations/:id/decline', requireRole('PLAYER'), async (req, res) => {
  const match = await matches.respondToInvitation(getAuth(req).user, idParam(req.params), false);
  res.json({ data: { matchId: match.id, status: match.status } });
});

matchRouter.get('/queue', requireRole('PLAYER'), async (req, res) => {
  res.json({ data: await matches.queueStatus(getAuth(req).user) });
});

matchRouter.post('/queue', requireRole('PLAYER'), async (req, res) => {
  const input = validate(queueSchema, req.body);
  const outcome = await matches.enqueue(getAuth(req).user, input);
  res.status(outcome.queued ? 202 : 201).json({
    data: outcome.queued ? { queued: true } : { queued: false, matchId: outcome.match.id },
  });
});

matchRouter.delete('/queue', requireRole('PLAYER'), async (req, res) => {
  res.json({ data: await matches.dequeue(getAuth(req).user) });
});

matchRouter.get('/:id', async (req, res) => {
  res.json({ data: await matches.getMatchState(getAuth(req).user, idParam(req.params)) });
});

matchRouter.get('/:id/moves', async (req, res) => {
  const state = await matches.getMatchState(getAuth(req).user, idParam(req.params));
  res.json({ data: state.moves });
});

matchRouter.get('/:id/replay', async (req, res) => {
  res.json({ data: await matches.getReplay(getAuth(req).user, idParam(req.params)) });
});

matchRouter.post('/:id/join', requireRole('PLAYER'), async (req, res) => {
  const match = await matches.joinOpenMatch(getAuth(req).user, idParam(req.params));
  res.json({ data: { id: match.id, status: match.status } });
});

matchRouter.post('/:id/invitations', requireRole('PLAYER'), async (req, res) => {
  const { inviteeId } = validate(inviteSchema, req.body);
  const match = await matches.inviteToMatch(getAuth(req).user, idParam(req.params), inviteeId);
  res.status(201).json({ data: { id: match.id, status: match.status } });
});

matchRouter.post('/:id/cancel', async (req, res) => {
  const { reason } = validate(cancelSchema, req.body);
  const match = await matches.cancelMatch(getAuth(req).user, idParam(req.params), reason);
  res.json({ data: { id: match.id, status: match.status } });
});

matchRouter.patch('/:id/notes', requireRole('ADMIN', 'COORDINATOR'), async (req, res) => {
  const { notes } = validate(notesSchema, req.body);
  await matches.updateNotes(getAuth(req).user, idParam(req.params), notes);
  res.json({ data: { ok: true } });
});

// HTTP equivalents of the realtime game actions (same service layer as the socket handlers).
matchRouter.post('/:id/resign', requireRole('PLAYER'), async (req, res) => {
  await gameplay.resign(getAuth(req).user, idParam(req.params));
  res.json({ data: { ok: true } });
});

matchRouter.post('/:id/draw-offers', requireRole('PLAYER'), async (req, res) => {
  await gameplay.offerDraw(getAuth(req).user, idParam(req.params));
  res.status(201).json({ data: { ok: true } });
});

matchRouter.post('/:id/draw-offers/respond', requireRole('PLAYER'), async (req, res) => {
  const { accept } = validate(z.object({ accept: z.boolean() }).strict(), req.body);
  await gameplay.respondDraw(getAuth(req).user, idParam(req.params), accept);
  res.json({ data: { ok: true } });
});

matchRouter.post('/:id/draw-claims', requireRole('PLAYER'), async (req, res) => {
  await gameplay.claimDraw(getAuth(req).user, idParam(req.params));
  res.json({ data: { ok: true } });
});

matchRouter.post('/:id/disputes', requireRole('PLAYER', 'COORDINATOR'), async (req, res) => {
  const { reason } = validate(disputeSchema, req.body);
  const dispute = await submitDispute(getAuth(req).user, idParam(req.params), reason);
  res.status(201).json({ data: dispute });
});
