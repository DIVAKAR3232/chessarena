/**
 * Result disputes. Players (own games) and supervising coordinators may open a dispute on a
 * finished match; only admins resolve it. A correction never silently rewrites history: the
 * original result is kept on the dispute, rating changes are reversed via the ledger, and every
 * step is audited.
 */
import type { DisputeStatus, MatchResult, Prisma } from '@prisma/client';
import { z } from 'zod';
import { badRequest, conflict, forbidden, invalidState, notFound } from '../../lib/errors.js';
import { pageMeta, toSkipTake, type Pagination } from '../../lib/pagination.js';
import { advisoryLock, prisma } from '../../lib/prisma.js';
import { canSuperviseMatch, isParticipant, type Actor } from '../../policies/index.js';
import { audit } from '../audit/audit.service.js';
import { assertTransition } from '../matches/lifecycle.js';
import { notify } from '../notifications/notification.service.js';
import { announceLeaderboardChange } from '../realtime/emitter.js';
import { applyRatings, reverseRatings } from '../ratings/rating.service.js';
import { recomputeWinner } from '../tournaments/tournament.service.js';

const DISPUTE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export async function submitDispute(actor: Actor, matchId: string, reason: string) {
  const m = await prisma.match.findUnique({ where: { id: matchId } });
  if (!m) throw notFound('Match');
  const allowed = isParticipant(actor, m) || (actor.role === 'COORDINATOR' && (await canSuperviseMatch(actor, m)));
  if (!allowed) throw forbidden('You cannot dispute this match');

  const { dispute, publish } = await prisma.$transaction(async (tx) => {
    await advisoryLock(tx, `match:${matchId}`);
    const match = await tx.match.findUniqueOrThrow({ where: { id: matchId } });
    if (match.status !== 'COMPLETED' && match.status !== 'ABANDONED') {
      throw invalidState('Only finished matches can be disputed');
    }
    if (match.completedAt && Date.now() - match.completedAt.getTime() > DISPUTE_WINDOW_MS) {
      throw invalidState('The dispute window (7 days) has closed');
    }
    const open = await tx.dispute.count({ where: { matchId, status: { in: ['OPEN', 'UNDER_REVIEW'] } } });
    if (open) throw conflict('A dispute is already open for this match');
    assertTransition(match.status, 'DISPUTED');
    await tx.match.update({ where: { id: matchId }, data: { status: 'DISPUTED' } });
    const dispute = await tx.dispute.create({
      data: { matchId, submittedByPlayerId: actor.id, reason, originalResult: match.result },
    });
    await audit(
      { actorId: actor.id, action: 'dispute.submit', resourceType: 'dispute', resourceId: dispute.id, details: { matchId } },
      tx,
    );
    const admins = await tx.user.findMany({ where: { role: 'ADMIN', accountStatus: 'ACTIVE' }, select: { id: true } });
    const { publish } = await notify(
      admins.map((a) => ({
        recipientId: a.id,
        type: 'DISPUTE_UPDATE' as const,
        title: 'New result dispute',
        message: `A dispute was submitted for match ${matchId}.`,
        relatedMatchId: matchId,
      })),
      tx,
    );
    return { dispute, publish };
  });
  publish();
  return dispute;
}

export const resolveDisputeSchema = z
  .object({
    decision: z.enum(['UPHOLD', 'CORRECT', 'REJECT']),
    correctedResult: z.enum(['WHITE_WIN', 'BLACK_WIN', 'DRAW', 'NO_RESULT']).optional(),
    resolution: z.string().trim().min(5).max(2000),
  })
  .strict()
  .refine((d) => d.decision !== 'CORRECT' || d.correctedResult, {
    message: 'correctedResult is required when correcting a result',
    path: ['correctedResult'],
  });

export async function resolveDispute(
  admin: Actor,
  disputeId: string,
  input: z.infer<typeof resolveDisputeSchema>,
) {
  if (admin.role !== 'ADMIN') throw forbidden();
  const d = await prisma.dispute.findUnique({ where: { id: disputeId } });
  if (!d) throw notFound('Dispute');

  const { publish, dispute } = await prisma.$transaction(async (tx) => {
    await advisoryLock(tx, `match:${d.matchId}`);
    const dispute = await tx.dispute.findUniqueOrThrow({ where: { id: disputeId } });
    if (dispute.status !== 'OPEN' && dispute.status !== 'UNDER_REVIEW') throw invalidState('Dispute already resolved');
    const match = await tx.match.findUniqueOrThrow({
      where: { id: dispute.matchId },
      include: { tournament: { select: { format: true } }, round: { select: { roundNumber: true } } },
    });
    if (match.status !== 'DISPUTED') throw invalidState('Match is not under dispute');
    const restoredStatus = match.terminationReason === 'ABANDONMENT' ? 'ABANDONED' : 'COMPLETED';

    let status: DisputeStatus;
    let newResult: MatchResult | null = match.result;
    if (input.decision === 'CORRECT') {
      const corrected = input.correctedResult!;
      if (corrected === match.result) throw badRequest('The corrected result equals the current result');
      if (match.tournament?.format === 'SINGLE_ELIMINATION' && match.tournamentId && match.round) {
        const later = await tx.tournamentRound.count({
          where: { tournamentId: match.tournamentId, roundNumber: { gt: match.round.roundNumber } },
        });
        if (later) throw invalidState('A later knockout round already exists; the bracket cannot be rewritten');
        // A knockout slot needs a winner, so corrections must stay decisive.
        if (corrected !== 'WHITE_WIN' && corrected !== 'BLACK_WIN') {
          throw badRequest('Knockout results can only be corrected to a win for one player');
        }
      }
      await reverseRatings(tx, match.id);
      const winnerId =
        corrected === 'WHITE_WIN' ? match.whitePlayerId : corrected === 'BLACK_WIN' ? match.blackPlayerId : null;
      await tx.match.update({
        where: { id: match.id },
        data: { status: 'COMPLETED', result: corrected, winnerId, terminationReason: 'ADMIN_DECISION' },
      });
      if (match.rated && corrected !== 'NO_RESULT' && match.whitePlayerId && match.blackPlayerId) {
        await applyRatings(tx, {
          id: match.id,
          whitePlayerId: match.whitePlayerId,
          blackPlayerId: match.blackPlayerId,
          result: corrected,
        });
      }
      newResult = corrected;
      status = 'RESOLVED_CORRECTED';
      if (match.tournamentId) {
        if (match.tournament?.format === 'SINGLE_ELIMINATION') {
          // Keep elimination flags consistent with the corrected winner.
          const loser = corrected === 'WHITE_WIN' ? match.blackPlayerId : match.whitePlayerId;
          const winner = corrected === 'WHITE_WIN' ? match.whitePlayerId : match.blackPlayerId;
          if (winner) await tx.tournamentParticipant.updateMany({ where: { tournamentId: match.tournamentId, playerId: winner, registrationStatus: 'ELIMINATED' }, data: { registrationStatus: 'REGISTERED' } });
          if (loser) await tx.tournamentParticipant.updateMany({ where: { tournamentId: match.tournamentId, playerId: loser, registrationStatus: 'REGISTERED' }, data: { registrationStatus: 'ELIMINATED' } });
        }
        await recomputeWinner(tx, match.tournamentId, admin.id);
      }
    } else {
      assertTransition('DISPUTED', restoredStatus);
      await tx.match.update({ where: { id: match.id }, data: { status: restoredStatus } });
      status = input.decision === 'UPHOLD' ? 'RESOLVED_UPHELD' : 'REJECTED';
    }

    const updated = await tx.dispute.update({
      where: { id: disputeId },
      data: {
        status,
        resolution: input.resolution,
        correctedResult: input.decision === 'CORRECT' ? newResult : null,
        resolvedByAdminId: admin.id,
        resolvedAt: new Date(),
      },
    });
    await audit(
      {
        actorId: admin.id,
        action: 'dispute.resolve',
        resourceType: 'dispute',
        resourceId: disputeId,
        details: { matchId: match.id, decision: input.decision, before: match.result, after: newResult },
      },
      tx,
    );
    const recipients = new Set([dispute.submittedByPlayerId, match.whitePlayerId, match.blackPlayerId].filter(Boolean) as string[]);
    const { publish } = await notify(
      [...recipients].map((r) => ({
        recipientId: r,
        type: 'DISPUTE_UPDATE' as const,
        title: 'Dispute resolved',
        message: `The dispute on match ${match.id} was resolved (${status.toLowerCase().replace(/_/g, ' ')}).`,
        relatedMatchId: match.id,
      })),
      tx,
    );
    return { publish, dispute: updated };
  });
  publish();
  announceLeaderboardChange();
  return dispute;
}

export const listDisputesQuery = z.object({
  status: z.enum(['OPEN', 'UNDER_REVIEW', 'RESOLVED_UPHELD', 'RESOLVED_CORRECTED', 'REJECTED']).optional(),
});

export async function listDisputes(actor: Actor, status: DisputeStatus | undefined, page: Pagination) {
  const where: Prisma.DisputeWhereInput = { ...(status ? { status } : {}) };
  if (actor.role === 'COORDINATOR') {
    where.match = {
      OR: [{ coordinatorId: actor.id }, { tournament: { coordinators: { some: { coordinatorId: actor.id } } } }],
    };
  } else if (actor.role === 'PLAYER') {
    where.submittedByPlayerId = actor.id;
  }
  const [total, items] = await prisma.$transaction([
    prisma.dispute.count({ where }),
    prisma.dispute.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      ...toSkipTake(page),
      include: {
        submittedBy: { select: { id: true, username: true, displayName: true } },
        resolvedBy: { select: { id: true, username: true, displayName: true } },
        match: {
          select: {
            id: true,
            result: true,
            status: true,
            terminationReason: true,
            whitePlayer: { select: { id: true, username: true, displayName: true } },
            blackPlayer: { select: { id: true, username: true, displayName: true } },
            tournament: { select: { id: true, name: true } },
          },
        },
      },
    }),
  ]);
  return { items, meta: pageMeta(page, total) };
}
