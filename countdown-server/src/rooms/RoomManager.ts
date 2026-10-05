/**
 * =============================================================================
 * FILE: src/rooms/RoomManager.ts
 * RESPONSIBILITY: Hold the LIVE, in-memory state of every match currently
 * being played — tiles, target, timers, running scores, who's submitted
 * what this round. This is the "server memory" half of the database/memory
 * split we designed: the `matches` table in Supabase is the durable pointer
 * ("this match exists, these are the players, here's its status"), while
 * THIS class is the fast-changing working state that has no reason to
 * touch the database until a round actually concludes.
 * =============================================================================
 */

import type { Tile } from '../types/events';

export interface RoundSubmission {
  result: number | null;
  timeMs: number | null;
}

export interface RoomState {
  matchId: string;

  player1Id: string;
  player2Id: string | null;

  player1SocketId: string | null;
  player2SocketId: string | null;

  currentRound: number;

  player1TotalRaw: number;
  player2TotalRaw: number;

  currentTiles: Tile[];
  currentTarget: number;
  currentSolvable: boolean;
  startTimestamp: number | null;

  roundTimer: NodeJS.Timeout | null;

  submissions: {
    player1?: RoundSubmission;
    player2?: RoundSubmission;
  };
}

export class RoomManager {
  private rooms = new Map<string, RoomState>();

  createRoom(matchId: string, player1Id: string): RoomState {
    const existing = this.rooms.get(matchId);
    if (existing) return existing;

    const room: RoomState = {
      matchId,
      player1Id,
      player2Id: null,
      player1SocketId: null,
      player2SocketId: null,
      currentRound: 0,
      player1TotalRaw: 0,
      player2TotalRaw: 0,
      currentTiles: [],
      currentTarget: 0,
      currentSolvable: false,
      startTimestamp: null,
      roundTimer: null,
      submissions: {},
    };

    this.rooms.set(matchId, room);
    return room;
  }

  getRoom(matchId: string): RoomState | undefined {
    return this.rooms.get(matchId);
  }

  joinRoom(matchId: string, player2Id: string): RoomState | undefined {
    const room = this.rooms.get(matchId);
    if (!room) return undefined;
    room.player2Id = player2Id;
    return room;
  }

  setSocketId(matchId: string, slot: 'player1' | 'player2', socketId: string): void {
    const room = this.rooms.get(matchId);
    if (!room) return;
    if (slot === 'player1') room.player1SocketId = socketId;
    else room.player2SocketId = socketId;
  }

  recordSubmission(
    matchId: string,
    slot: 'player1' | 'player2',
    submission: RoundSubmission
  ): void {
    const room = this.rooms.get(matchId);
    if (!room) return;
    room.submissions[slot] = submission;
  }

  bothSubmitted(matchId: string): boolean {
    const room = this.rooms.get(matchId);
    if (!room) return false;
    return Boolean(room.submissions.player1 && room.submissions.player2);
  }

  resetRound(
    matchId: string,
    tiles: Tile[],
    target: number,
    solvable: boolean,
    startTimestamp: number
  ): void {
    const room = this.rooms.get(matchId);
    if (!room) return;

    room.currentRound += 1;
    room.currentTiles = tiles;
    room.currentTarget = target;
    room.currentSolvable = solvable;
    room.startTimestamp = startTimestamp;
    room.submissions = {};

    if (room.roundTimer) {
      clearTimeout(room.roundTimer);
      room.roundTimer = null;
    }
  }

  setRoundTimer(matchId: string, timer: NodeJS.Timeout): void {
    const room = this.rooms.get(matchId);
    if (!room) return;
    room.roundTimer = timer;
  }

  addPoints(matchId: string, player1PointsRaw: number, player2PointsRaw: number): void {
    const room = this.rooms.get(matchId);
    if (!room) return;
    room.player1TotalRaw += player1PointsRaw;
    room.player2TotalRaw += player2PointsRaw;
  }

  getSlotByUserId(matchId: string, userId: string): 'player1' | 'player2' | null {
    const room = this.rooms.get(matchId);
    if (!room) return null;
    if (room.player1Id === userId) return 'player1';
    if (room.player2Id === userId) return 'player2';
    return null;
  }

  getSlotBySocketId(matchId: string, socketId: string): 'player1' | 'player2' | null {
    const room = this.rooms.get(matchId);
    if (!room) return null;
    if (room.player1SocketId === socketId) return 'player1';
    if (room.player2SocketId === socketId) return 'player2';
    return null;
  }

  removeRoom(matchId: string): void {
    const room = this.rooms.get(matchId);
    if (room?.roundTimer) clearTimeout(room.roundTimer);
    this.rooms.delete(matchId);
  }
}
