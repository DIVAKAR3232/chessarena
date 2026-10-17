import type { Prisma } from '@prisma/client';

/** Fields safe to return to the account owner and admins. Never includes passwordHash. */
export const privateUserSelect = {
  id: true,
  username: true,
  displayName: true,
  email: true,
  role: true,
  accountStatus: true,
  emailVerifiedAt: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  profilePublic: true,
  avatar: true,
  notifyByEmail: true,
  profile: { select: { rating: true, peakRating: true } },
} satisfies Prisma.UserSelect;

/** Fields safe to show to any other user. */
export const publicUserSelect = {
  id: true,
  username: true,
  displayName: true,
  role: true,
  avatar: true,
  createdAt: true,
  profile: { select: { rating: true, peakRating: true } },
} satisfies Prisma.UserSelect;

/** Minimal player card used inside match payloads. */
export const playerCardSelect = {
  id: true,
  username: true,
  displayName: true,
  avatar: true,
  profile: { select: { rating: true } },
} satisfies Prisma.UserSelect;

export type PrivateUser = Prisma.UserGetPayload<{ select: typeof privateUserSelect }>;
export type PlayerCardRow = Prisma.UserGetPayload<{ select: typeof playerCardSelect }>;

export function toPlayerCard(u: PlayerCardRow | null) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    avatar: u.avatar,
    rating: u.profile?.rating ?? null,
  };
}
