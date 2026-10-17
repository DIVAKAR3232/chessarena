import type { MatchListItem } from '../../types/api';

export type TournamentStatus = 'DRAFT' | 'PUBLISHED' | 'REGISTRATION_OPEN' | 'REGISTRATION_CLOSED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface TournamentSummary {
  id: string;
  name: string;
  description: string;
  format: 'ROUND_ROBIN' | 'SINGLE_ELIMINATION';
  status: TournamentStatus;
  initialTimeMs: number;
  incrementMs: number;
  rated: boolean;
  maxParticipants: number;
  minParticipants: number;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  winner: { id: string; displayName: string } | null;
  coordinators: { coordinator: { id: string; displayName: string; username?: string } }[];
  _count: { participants: number; rounds?: number };
}

export interface TournamentDetail extends TournamentSummary {
  pointsWin: number;
  pointsDraw: number;
  pointsLoss: number;
  pointsBye: number;
  cancelReason: string | null;
  canManage: boolean;
  myRegistration: string | null;
  plannedRounds: number;
  createdBy: { id: string; displayName: string };
}

export interface Participant {
  registrationStatus: string;
  registeredAt: string;
  seed: number | null;
  ratingAtRegistration: number;
  player: { id: string; username: string; displayName: string; profile: { rating: number } | null };
}

export interface StandingRow {
  rank: number;
  id: string;
  username: string;
  displayName: string;
  seed: number | null;
  rating: number | null;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  byes: number;
  points: number;
  sonnebornBerger: number;
  eliminated: boolean;
}

export interface Round {
  id: string;
  roundNumber: number;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  startsAt: string | null;
  completedAt: string | null;
  matches: (MatchListItem & { bracketSlot: number | null; isBye: boolean })[];
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  author: { displayName: string };
}

export const tournamentTone = (s: TournamentStatus): 'green' | 'gray' | 'amber' | 'red' | 'blue' =>
  s === 'REGISTRATION_OPEN' ? 'green' : s === 'IN_PROGRESS' ? 'blue' : s === 'CANCELLED' ? 'red' : s === 'DRAFT' ? 'amber' : 'gray';
