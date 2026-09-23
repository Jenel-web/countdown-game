import type { Step, Tile, PlayerRoundResult } from '../game/gameEngine';

export interface ServerToClientEvents {
  round_start: (payload: {
    roundNumber: number;
    tiles: Tile[];
    target: number;
    startTimestamp: number;
    durationMs: number;
  }) => void;
  round_result: (payload: {
    roundNumber: number;
    solvable: boolean;
    player1: PlayerRoundResult;
    player2: PlayerRoundResult;
    player1TotalRaw: number;
    player2TotalRaw: number;
  }) => void;
  match_over: (payload: {
    winnerId: string;
    player1TotalRaw: number;
    player2TotalRaw: number;
  }) => void;
  player_status: (payload: {
    userId: string;
    status: string;
  }) => void;
  error: (payload: {
    code: string;
    message: string;
  }) => void;
  [event: string]: (...args: any[]) => void;
}

export interface ClientToServerEvents {
  player_status: (payload: { status: string }) => void;
  submit_answer: (payload: { steps: Step[]; resultValue?: number }) => void;
  [event: string]: (...args: any[]) => void;
}

export interface InterServerEvents {
  [event: string]: (...args: any[]) => void;
}

export interface SocketData {
  userId: string;
  matchId?: string;
  [key: string]: any;
}
