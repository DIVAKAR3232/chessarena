import type { Prisma } from '@prisma/client';
import { logger } from '../../config/logger.js';
import { prisma, type Tx } from '../../lib/prisma.js';

export interface AuditEntry {
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  /** Never include passwords, tokens or other secrets here. */
  details?: Prisma.InputJsonValue;
}

export async function audit(entry: AuditEntry, tx: Tx = prisma): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      details: entry.details,
    },
  });
  logger.info(
    { audit: { actor: entry.actorId, action: entry.action, type: entry.resourceType, id: entry.resourceId } },
    'audit',
  );
}
