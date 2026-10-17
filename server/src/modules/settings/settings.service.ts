import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { audit } from '../audit/audit.service.js';

/** Non-secret, admin-editable platform settings. Secrets stay in environment variables. */
export const settingsSchema = z.object({
  platformName: z.string().min(1).max(60),
  registrationOpen: z.boolean(),
  maintenanceMode: z.boolean(),
  maintenanceMessage: z.string().max(300),
  matchmakingEnabled: z.boolean(),
  defaultInitialTimeMs: z.number().int().min(30_000).max(3 * 60 * 60_000),
  defaultIncrementMs: z.number().int().min(0).max(180_000),
  customMinInitialMs: z.number().int().min(30_000).max(3 * 60 * 60_000),
  customMaxInitialMs: z.number().int().min(30_000).max(3 * 60 * 60_000),
  customMaxIncrementMs: z.number().int().min(0).max(180_000),
  maxTournamentParticipants: z.number().int().min(2).max(512),
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  platformName: 'ChessArena',
  registrationOpen: true,
  maintenanceMode: false,
  maintenanceMessage: 'ChessArena is under maintenance. Please try again shortly.',
  matchmakingEnabled: true,
  defaultInitialTimeMs: 5 * 60_000,
  defaultIncrementMs: 3_000,
  customMinInitialMs: 60_000,
  customMaxInitialMs: 90 * 60_000,
  customMaxIncrementMs: 60_000,
  maxTournamentParticipants: 128,
};

let cache: { value: Settings; at: number } | null = null;
const TTL_MS = 5_000;

export async function getSettings(): Promise<Settings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const rows = await prisma.systemSetting.findMany();
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (row.key in DEFAULT_SETTINGS) merged[row.key] = row.value;
  }
  const parsed = settingsSchema.safeParse(merged);
  const value = parsed.success ? parsed.data : DEFAULT_SETTINGS;
  cache = { value, at: Date.now() };
  return value;
}

export async function updateSettings(actorId: string, patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = settingsSchema.parse({ ...current, ...patch });
  if (next.customMinInitialMs > next.customMaxInitialMs) {
    throw new Error('customMinInitialMs must not exceed customMaxInitialMs');
  }
  await prisma.$transaction(async (tx) => {
    for (const [key, value] of Object.entries(patch)) {
      await tx.systemSetting.upsert({
        where: { key },
        create: { key, value: value as never, updatedById: actorId },
        update: { value: value as never, updatedById: actorId },
      });
    }
    await audit({ actorId, action: 'settings.update', resourceType: 'settings', details: patch }, tx);
  });
  cache = null;
  return next;
}

export function clearSettingsCache() {
  cache = null;
}
