/**
 * In-memory presence of match participants (socket ids per user per match).
 * Single-instance only: documented limitation. Authoritative game state never depends on it.
 */
const presence = new Map<string, Map<string, Set<string>>>();

export function addPresence(matchId: string, userId: string, socketId: string): boolean {
  let users = presence.get(matchId);
  if (!users) {
    users = new Map();
    presence.set(matchId, users);
  }
  let sockets = users.get(userId);
  const wasAbsent = !sockets || sockets.size === 0;
  if (!sockets) {
    sockets = new Set();
    users.set(userId, sockets);
  }
  sockets.add(socketId);
  return wasAbsent;
}

/** Returns true when the user has no sockets left in the match. */
export function removePresence(matchId: string, userId: string, socketId: string): boolean {
  const sockets = presence.get(matchId)?.get(userId);
  if (!sockets) return false;
  sockets.delete(socketId);
  return sockets.size === 0;
}

export function isPresent(matchId: string, userId: string | null | undefined): boolean {
  if (!userId) return false;
  return (presence.get(matchId)?.get(userId)?.size ?? 0) > 0;
}

export function clearMatchPresence(matchId: string) {
  presence.delete(matchId);
}
