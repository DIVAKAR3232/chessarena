import type { NotificationType } from '@prisma/client';
import { prisma, type Tx } from '../../lib/prisma.js';
import { emitToUser } from '../realtime/emitter.js';

export interface NewNotification {
  recipientId: string;
  type: NotificationType;
  title: string;
  message: string;
  relatedMatchId?: string | null;
  relatedTournamentId?: string | null;
}

/**
 * Persists notifications and pushes them over Socket.IO.
 * When called inside a transaction, pass `tx` and call the returned `publish` after commit.
 */
export async function notify(items: NewNotification[], tx: Tx = prisma) {
  const created = await Promise.all(
    items.map((n) =>
      tx.notification.create({
        data: {
          recipientId: n.recipientId,
          type: n.type,
          title: n.title,
          message: n.message,
          relatedMatchId: n.relatedMatchId ?? null,
          relatedTournamentId: n.relatedTournamentId ?? null,
        },
      }),
    ),
  );
  const publish = () => {
    for (const n of created) emitToUser(n.recipientId, 'notification:new', n);
  };
  if (tx === prisma) publish();
  return { created, publish };
}
