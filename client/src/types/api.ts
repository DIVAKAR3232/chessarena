export type Role = 'ADMIN' | 'COORDINATOR' | 'PLAYER';
export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
export type MatchStatus =
  | 'CREATED'
  | 'WAITING'
  | 'READY'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'ABANDONED'
  | 'DISPUTED';
export type MatchResult = 'WHITE_WIN' | 'BLACK_WIN' | 'DRAW' | 'NO_RESULT';

export interface Me {
  id: string;
  username: string;
  displayName: string;
  email: string;
  role: Role;
  accountStatus: AccountStatus;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  profilePublic: boolean;
  avatar: string | null;
  notifyByEmail: boolean;
  profile: { rating: number; peakRating: number } | null;
}

export interface PlayerCard {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  rating: number | null;
}

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  avatar: string | null;
  createdAt: string;
  profile: { rating: number; peakRating: number } | null;
}

export interface MoveRecord {
  ply: number;
  san: string;
  from: string;
  to: string;
  promotion: string | null;
  clockAfterMs: number;
  elapsedMs: number;
  fenAfter: string;
}

export interface MatchState {
  id: string;
  status: MatchStatus;
  result: MatchResult | null;
  terminationReason: string | null;
  winnerId: string | null;
  source: string;
  rated: boolean;
  isPrivate: boolean;
  initialTimeMs: number;
  incrementMs: number;
  initialFen: string;
  fen: string;
  pgn: string;
  turn: 'w' | 'b';
  version: number;
  white: PlayerCard | null;
  black: PlayerCard | null;
  whiteConnected: boolean;
  blackConnected: boolean;
  clocks: { white: number; black: number; running: 'w' | 'b' | null };
  serverTime: number;
  moves: MoveRecord[];
  drawOffer: { offeredBy: string; ply: number } | null;
  claimableDraw: string | null;
  tournament: { id: string; name: string; format: string } | null;
  round: { id: string; roundNumber: number } | null;
  coordinator: { id: string; username: string; displayName: string } | null;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  createdById: string;
  cancelReason: string | null;
  whiteJoined: boolean;
  blackJoined: boolean;
  notes?: string | null;
}

export interface MatchListItem {
  id: string;
  status: MatchStatus;
  result: MatchResult | null;
  terminationReason: string | null;
  winnerId: string | null;
  source: string;
  rated: boolean;
  isPrivate: boolean;
  initialTimeMs: number;
  incrementMs: number;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  createdById: string;
  white: PlayerCard | null;
  black: PlayerCard | null;
  tournament: { id: string; name: string } | null;
  round: { roundNumber: number } | null;
  coordinator: { id: string; displayName: string } | null;
}

export interface Invitation {
  id: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  inviterId: string;
  inviteeId: string;
  inviter: { id: string; username: string; displayName: string; profile: { rating: number } | null };
  invitee: { id: string; username: string; displayName: string; profile: { rating: number } | null };
  match: { id: string; initialTimeMs: number; incrementMs: number; rated: boolean; whitePlayerId: string | null; blackPlayerId: string | null };
}

export interface PlayerStats {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
}

export interface LeaderboardRow extends PlayerStats {
  rank: number;
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  rating: number;
  peakRating: number;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  relatedMatchId: string | null;
  relatedTournamentId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paged<T> {
  data: T[];
  meta: PageMeta;
}

export interface PublicSettings {
  platformName: string;
  registrationOpen: boolean;
  maintenanceMode: boolean;
  maintenanceMessage: string | null;
  matchmakingEnabled: boolean;
  defaultInitialTimeMs: number;
  defaultIncrementMs: number;
  customMinInitialMs: number;
  customMaxInitialMs: number;
  customMaxIncrementMs: number;
}

export interface TimeControlPreset {
  id: string;
  label: string;
  category: 'bullet' | 'blitz' | 'rapid';
  initialTimeMs: number;
  incrementMs: number;
}
