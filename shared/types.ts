import type { RGB } from './color.ts';

export const AVATARS = ['🦊', '🐙', '🦉', '🐸', '🐼', '🐧', '🦋', '🦝', '🐱', '🐻', '🦄', '🐝'] as const;

export interface RoomSettings {
  timerSeconds: number;
  grayPercent: number;
  strictness: number;
}

export interface PublicPlayer {
  id: string;
  nickname: string;
  avatar: string;
  connected: boolean;
  score: number;
  isHost: boolean;
  isDescriber: boolean;
  hasGuessed: boolean;
  inCurrentGame: boolean;
}

export interface GuessResult {
  playerId: string;
  nickname: string;
  avatar: string;
  color: RGB | null;
  distance: number | null;
  points: number;
  autoSubmitted: boolean;
}

export interface FinishedGame {
  id: string;
  finishedAt: string;
  winners: string[];
  leaderboard: Array<{ nickname: string; avatar: string; score: number }>;
}

export type Phase = 'lobby' | 'clue' | 'guess' | 'reveal' | 'finished';

export interface RoomView {
  code: string;
  selfId: string;
  phase: Phase;
  settings: RoomSettings;
  players: PublicPlayer[];
  roundNumber: number;
  totalRounds: number;
  describerId: string | null;
  target: RGB | null;
  clue: string | null;
  deadline: number | null;
  phaseStartedAt: number;
  selfDraft: RGB | null;
  results: GuessResult[] | null;
  describerPoints: number | null;
  skipped: boolean;
  history: FinishedGame[];
}
