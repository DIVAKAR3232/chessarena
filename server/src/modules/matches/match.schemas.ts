import { z } from 'zod';

const id = z.string().min(1).max(40);
const square = z.string().regex(/^[a-h][1-8]$/, 'Invalid square');

export const timeControlSchema = z.object({
  initialTimeMs: z.number().int().min(30_000).max(3 * 60 * 60_000),
  incrementMs: z.number().int().min(0).max(180_000),
});

export const createChallengeSchema = timeControlSchema
  .extend({
    opponentId: id.optional(),
    color: z.enum(['white', 'black', 'random']).default('random'),
    rated: z.boolean().default(true),
    isPrivate: z.boolean().default(false),
  })
  .strict();

export const createAssignedMatchSchema = timeControlSchema
  .extend({
    whitePlayerId: id,
    blackPlayerId: id,
    tournamentId: id.optional(),
    scheduledAt: z.coerce.date().optional(),
    rated: z.boolean().default(true),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict()
  .refine((d) => d.whitePlayerId !== d.blackPlayerId, {
    message: 'A player cannot play against themselves',
    path: ['blackPlayerId'],
  });

export const inviteSchema = z.object({ inviteeId: id }).strict();

export const cancelSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();

export const notesSchema = z.object({ notes: z.string().trim().max(2000) }).strict();

export const moveSchema = z
  .object({
    matchId: id,
    from: square,
    to: square,
    promotion: z.enum(['q', 'r', 'b', 'n']).optional().nullable(),
    version: z.number().int().min(0),
  })
  .strict();

export const matchIdSchema = z.object({ matchId: id }).strict();

export const drawRespondSchema = z.object({ matchId: id, accept: z.boolean() }).strict();

export const listMatchesQuery = z.object({
  status: z
    .enum(['CREATED', 'WAITING', 'READY', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'ABANDONED', 'DISPUTED'])
    .optional(),
  scope: z.enum(['mine', 'open', 'public']).default('mine'),
  playerId: id.optional(),
  tournamentId: id.optional(),
  coordinatorId: id.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sort: z.enum(['createdAt', 'completedAt', 'scheduledAt']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const queueSchema = timeControlSchema.extend({ rated: z.boolean().default(true) }).strict();

export const disputeSchema = z.object({ reason: z.string().trim().min(10).max(2000) }).strict();
