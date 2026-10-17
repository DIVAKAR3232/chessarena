import type { Server } from 'socket.io';

/**
 * Indirection so services can push realtime events without importing the Socket.IO bootstrap
 * (and without a hard dependency on a running server, e.g. in unit tests).
 */
let io: Server | null = null;

export function setIo(server: Server | null) {
  io = server;
}

export function getIo(): Server | null {
  return io;
}

export const userRoom = (userId: string) => `user:${userId}`;
export const matchRoom = (matchId: string) => `match:${matchId}`;

export function emitToUser(userId: string, event: string, payload: unknown) {
  io?.to(userRoom(userId)).emit(event, payload);
}

export function emitToMatch(matchId: string, event: string, payload: unknown) {
  io?.to(matchRoom(matchId)).emit(event, payload);
}
