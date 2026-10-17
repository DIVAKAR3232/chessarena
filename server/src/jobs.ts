import { logger } from './config/logger.js';
import { prisma } from './lib/prisma.js';
import { rescheduleLiveMatches } from './modules/matches/gameplay.service.js';
import { expireStaleInvitations } from './modules/matches/match.service.js';
import { cancelAllTimers } from './modules/matches/timers.js';

let interval: NodeJS.Timeout | null = null;

async function housekeeping() {
  try {
    const expired = await expireStaleInvitations();
    if (expired.invitations || expired.openChallenges) logger.info(expired, 'Expired stale invitations/challenges');
    // Matchmaking entries older than 10 minutes are dropped (players must re-queue).
    await prisma.matchmakingQueueEntry.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 10 * 60_000) } } });
    // Purge expired/revoked sessions and used tokens after 30 days.
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000);
    await prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] } });
    await prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: cutoff } } });
  } catch (err) {
    logger.error({ err }, 'Housekeeping job failed');
  }
}

export async function startBackgroundJobs() {
  const live = await rescheduleLiveMatches();
  logger.info({ liveMatches: live }, 'Rescheduled clocks for live matches');
  await housekeeping();
  interval = setInterval(() => void housekeeping(), 30_000);
  interval.unref();
}

export function stopBackgroundJobs() {
  if (interval) clearInterval(interval);
  interval = null;
  cancelAllTimers();
}
