/**
 * Realtime Database is not a JSON store — it drops keys whose value is null, and
 * an empty array or object is stored as nothing at all. A GameState written and
 * read back therefore comes home with holes: `dice: null` vanishes,
 * `winnerOrder: []` vanishes, `captures: []` inside lastEvent vanishes.
 *
 * Everything read from the database goes through here first, so the rest of the
 * app only ever sees a complete, correctly typed GameState.
 */

import { DEFAULT_TOKEN_COUNT, isTokenCount } from '../game/board';
import type { Color, GameEvent, GameState, Move, Player, Token, TurnPhase } from '../game/types';
import { COLORS } from '../game/types';

export type RoomStatus = 'waiting' | 'playing' | 'finished';

export interface RoomPlayer {
  name: string;
  color: Color;
  joinedAt: number;
  /** Presence, maintained by onDisconnect. Absent means assume present. */
  connected?: boolean;
  /** Server time of the last disconnect, for grace-period arithmetic. */
  disconnectedAt?: number;
}

/** Why a finished room finished — a real result, or everyone leaving. */
export type EndedReason = 'won' | 'abandoned';

export interface Room {
  id: string;
  hostId: string;
  status: RoomStatus;
  players: Record<string, RoomPlayer>;
  gameState: GameState | null;
  createdAt: number;
  endedReason: EndedReason | null;
  /** Tokens each player gets, chosen by the host when the room is created. */
  tokenCount: number;
}

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null;

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const str = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback;

/** A list of dice faces, however the database chose to store it. */
const toNumbers = (value: unknown): number[] =>
  toArray(value).filter((n): n is number => typeof n === 'number' && Number.isFinite(n));

const isColor = (value: unknown): value is Color =>
  typeof value === 'string' && (COLORS as readonly string[]).includes(value);

/**
 * RTDB returns a list as an array when its keys are 0..n, but as an object when
 * anything is missing. Accept both and drop holes.
 */
function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.filter((item) => item !== null && item !== undefined);
  if (isRecord(value)) {
    return Object.keys(value)
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => value[key])
      .filter((item) => item !== null && item !== undefined);
  }
  return [];
}

function toToken(value: unknown, color: Color, index: number): Token {
  const raw = isRecord(value) ? value : {};
  return {
    id: str(raw.id, `${color}-${index}`),
    color: isColor(raw.color) ? raw.color : color,
    progress: num(raw.progress, 0),
  };
}

function toPlayer(value: unknown, index: number): Player | null {
  if (!isRecord(value) || !isColor(value.color)) return null;
  const color = value.color;
  const tokens = toArray(value.tokens).map((token, i) => toToken(token, color, i));
  const player: Player = {
    color,
    name: str(value.name, `Player ${index + 1}`),
    tokens,
    finished: value.finished === true,
  };
  // Only carry the multiplayer fields when the snapshot actually has them —
  // a local game's players have neither, and normalizing must not invent them.
  if (typeof value.uid === 'string') player.uid = value.uid;
  if (typeof value.connected === 'boolean') player.connected = value.connected;
  return player;
}

function toMove(value: unknown): Move | null {
  if (!isRecord(value) || typeof value.tokenId !== 'string') return null;
  return {
    tokenId: value.tokenId,
    die: num(value.die, 0),
    from: num(value.from, 0),
    to: num(value.to, 0),
    kind: (value.kind as Move['kind']) ?? 'advance',
    captures: toArray(value.captures).filter((id): id is string => typeof id === 'string'),
  };
}

function toEvent(value: unknown): GameEvent | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;

  switch (value.type) {
    case 'rolled':
      return isColor(value.color)
        ? { type: 'rolled', color: value.color, value: num(value.value, 0) }
        : null;
    case 'moved': {
      const move = toMove(value.move);
      return move && isColor(value.color) ? { type: 'moved', color: value.color, move } : null;
    }
    case 'captured':
      return isColor(value.by)
        ? {
            type: 'captured',
            by: value.by,
            tokenIds: toArray(value.tokenIds).filter((id): id is string => typeof id === 'string'),
          }
        : null;
    case 'threeSixes':
      return isColor(value.color) ? { type: 'threeSixes', color: value.color } : null;
    case 'skipped':
      return isColor(value.color) ? { type: 'skipped', color: value.color } : null;
    case 'noLegalMove':
      return isColor(value.color)
        ? { type: 'noLegalMove', color: value.color, values: toNumbers(value.values) }
        : null;
    case 'finishedToken':
      return isColor(value.color)
        ? { type: 'finishedToken', color: value.color, tokenId: str(value.tokenId, '') }
        : null;
    case 'playerWon':
      return isColor(value.color)
        ? { type: 'playerWon', color: value.color, place: num(value.place, 1) }
        : null;
    default:
      return null;
  }
}

const PHASES: TurnPhase[] = ['awaiting-roll', 'awaiting-move', 'game-over'];

/** Rebuild a GameState from a database snapshot, or null if it is unusable. */
export function toGameState(value: unknown): GameState | null {
  if (!isRecord(value)) return null;

  const players = toArray(value.players)
    .map((player, index) => toPlayer(player, index))
    .filter((player): player is Player => player !== null);
  if (players.length < 2) return null;

  const phase = PHASES.includes(value.phase as TurnPhase)
    ? (value.phase as TurnPhase)
    : 'awaiting-roll';

  return {
    players,
    turnIndex: Math.min(num(value.turnIndex, 0), players.length - 1),
    phase,
    // Both are lists now, and an empty one is stored as nothing at all, so a
    // missing key has to come back as [] rather than as a hole.
    dice: toNumbers(value.dice),
    lastRoll: toNumbers(value.lastRoll),
    consecutiveSixes: num(value.consecutiveSixes, 0),
    winnerOrder: toArray(value.winnerOrder).filter(isColor),
    rngSeed: num(value.rngSeed, 0),
    lastEvent: toEvent(value.lastEvent),
    version: num(value.version, 0),
  };
}

function toRoomPlayer(value: unknown): RoomPlayer | null {
  if (!isRecord(value) || !isColor(value.color)) return null;
  const player: RoomPlayer = {
    name: str(value.name, 'Player'),
    color: value.color,
    joinedAt: num(value.joinedAt, 0),
    connected: value.connected !== false,
  };
  if (typeof value.disconnectedAt === 'number') player.disconnectedAt = value.disconnectedAt;
  return player;
}

/** Rebuild a Room from a database snapshot, or null if the room is missing. */
export function toRoom(id: string, value: unknown): Room | null {
  if (!isRecord(value)) return null;

  const players: Record<string, RoomPlayer> = {};
  if (isRecord(value.players)) {
    for (const [uid, raw] of Object.entries(value.players)) {
      const player = toRoomPlayer(raw);
      if (player) players[uid] = player;
    }
  }

  const status = (['waiting', 'playing', 'finished'] as const).includes(value.status as RoomStatus)
    ? (value.status as RoomStatus)
    : 'waiting';

  const endedReason =
    value.endedReason === 'won' || value.endedReason === 'abandoned' ? value.endedReason : null;

  return {
    id,
    hostId: str(value.hostId, ''),
    status,
    players,
    gameState: toGameState(value.gameState),
    createdAt: num(value.createdAt, 0),
    endedReason,
    // Rooms created before this was a choice have no field; they are four.
    tokenCount: isTokenCount(value.tokenCount) ? (value.tokenCount as number) : DEFAULT_TOKEN_COUNT,
  };
}

/**
 * Strip values Realtime Database refuses to store. `undefined` throws on write,
 * so it must never reach the SDK.
 */
export function forDatabase<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_, v) => (v === undefined ? null : v))) as T;
}
