/**
 * The decision logic behind every room write, as pure functions.
 *
 * Realtime Database transactions hand you whatever is currently stored and ask
 * for the next value (or `undefined` to abort). Keeping that decision separate
 * from the SDK call means the interesting part — who is allowed to write what,
 * and when — is unit-testable without Firebase, an emulator, or a network.
 */

import { OPPOSITE_CORNER, SEATING_ORDER } from '../game/board';
import { isGameOver, skipTurn } from '../game/engine';
import type { Color, GameState } from '../game/types';
import { COLORS } from '../game/types';
import {
  forDatabase,
  toGameState,
  type EndedReason,
  type RoomPlayer,
  type RoomStatus,
} from './serialize';

export const MAX_PLAYERS = 4;

/** How long a player may be away before the table plays on without them. */
export const SKIP_GRACE_MS = 20_000;
/** How long a table sits with fewer than two players before it is called off. */
export const ABANDON_GRACE_MS = 60_000;

export type RoomError =
  | 'not-found'
  | 'already-started'
  | 'room-full'
  | 'not-host'
  | 'not-enough-players'
  | 'not-your-turn'
  | 'illegal-move'
  | 'no-code'
  /** The watchdog looked, and there was nothing to do. Never shown to a player. */
  | 'nothing-to-do'
  | 'color-taken'
  /** The database refused the write — rules, network, or a malformed value. */
  | 'write-failed';

export const ROOM_ERROR_TEXT: Record<RoomError, string> = {
  'not-found': 'No room with that code.',
  'already-started': 'That game has already started.',
  'room-full': 'That room is full.',
  'not-host': 'Only the host can start the game.',
  'not-enough-players': 'At least 2 players are needed.',
  'not-your-turn': 'It is not your turn.',
  'illegal-move': 'That move is no longer legal.',
  'no-code': 'Could not create a room. Try again.',
  'write-failed': 'The database refused that write.',
  'nothing-to-do': '',
  'color-taken': 'Someone else took that colour.',
};

/** The room as it is stored. Loosely typed — this is what the database hands back. */
export interface StoredRoom {
  hostId: string;
  status: RoomStatus;
  players: Record<string, RoomPlayer>;
  gameState?: unknown;
  createdAt?: unknown;
  endedReason?: EndedReason;
}

export type Decision =
  | { ok: true; value: StoredRoom }
  | { ok: false; error: RoomError };

const deny = (error: RoomError): Decision => ({ ok: false, error });
const allow = (value: StoredRoom): Decision => ({ ok: true, value });

function asRoom(current: unknown): StoredRoom | null {
  if (typeof current !== 'object' || current === null) return null;
  const raw = current as Partial<StoredRoom>;
  if (typeof raw.hostId !== 'string') return null;

  const room: StoredRoom = {
    hostId: raw.hostId,
    status: raw.status ?? 'waiting',
    players: raw.players ?? {},
  };
  // Optional keys are only set when they exist. Realtime Database throws on any
  // `undefined` in a value, so a waiting room must not carry `gameState:
  // undefined` into the write it is about to become.
  if (raw.gameState !== undefined) room.gameState = raw.gameState;
  if (raw.createdAt !== undefined) room.createdAt = raw.createdAt;
  if (raw.endedReason !== undefined) room.endedReason = raw.endedReason;
  return room;
}

/** A player counts as present unless presence explicitly says otherwise. */
export function isPresent(player: RoomPlayer | undefined): boolean {
  return player !== undefined && player.connected !== false;
}

export function presentUids(players: Record<string, RoomPlayer>): string[] {
  return Object.keys(players).filter((uid) => isPresent(players[uid]));
}

/** How long a player has been away, in milliseconds of server time. */
function awayFor(player: RoomPlayer | undefined, now: number): number {
  if (!player || isPresent(player)) return 0;
  // A missing timestamp means we cannot date the disconnect; treat it as old,
  // otherwise a player who vanished without one would block the table forever.
  return player.disconnectedAt === undefined ? Number.POSITIVE_INFINITY : now - player.disconnectedAt;
}

/**
 * The first color no one has taken. Handed out in SEATING_ORDER rather than turn
 * order, so the first two players land in opposite corners.
 */
export function freeColor(players: Record<string, RoomPlayer>): Color | null {
  const taken = new Set(Object.values(players).map((p) => p.color));
  return SEATING_ORDER.find((color) => !taken.has(color)) ?? null;
}

/**
 * Move a two-player table onto opposite corners, keeping the host where they
 * are. Join order already seats the first two diagonally; this catches the table
 * that got there another way — a third player who joined and left, or a colour
 * picked by hand in the lobby.
 *
 * Left alone at three or four players: every corner is in use, or the empty one
 * is nobody's to argue over.
 */
export function seatOppositeCorners(
  players: Record<string, RoomPlayer>,
  hostId: string,
): Record<string, RoomPlayer> {
  const uids = Object.keys(players);
  if (uids.length !== 2) return players;

  const host = uids.includes(hostId) ? hostId : uids[0];
  const guest = uids.find((uid) => uid !== host)!;
  const across = OPPOSITE_CORNER[players[host].color];
  if (players[guest].color === across) return players;

  return { ...players, [guest]: { ...players[guest], color: across } };
}

/** Seats sorted into clockwise turn order. */
export function seatsOf(players: Record<string, RoomPlayer>) {
  return Object.entries(players)
    .map(([uid, player]) => ({ uid, ...player }))
    .sort((a, b) => COLORS.indexOf(a.color) - COLORS.indexOf(b.color));
}

/** The uid that owns the seat currently to move, if the seat is claimed. */
export function currentSeatUid(state: GameState): string | undefined {
  return state.players[state.turnIndex]?.uid;
}

// ---------------------------------------------------------------------------
// Reducers — one per write path
// ---------------------------------------------------------------------------

/**
 * Join, or re-join. Re-entering a room you already hold a seat in is always
 * allowed, so a refresh mid-game puts you back in your seat rather than being
 * turned away for the game having started.
 */
export function decideJoin(
  current: unknown,
  uid: string,
  name: string,
  now: number = Date.now(),
): Decision {
  const room = asRoom(current);
  if (!room) return deny('not-found');
  if (room.players[uid]) return allow(room);
  if (room.status !== 'waiting') return deny('already-started');

  const color = freeColor(room.players);
  if (!color || Object.keys(room.players).length >= MAX_PLAYERS) return deny('room-full');

  return allow({
    ...room,
    players: {
      ...room.players,
      [uid]: { name, color, joinedAt: now, connected: true },
    },
  });
}

/**
 * Take a different colour in the lobby. Done as a transaction so two players
 * reaching for the same seat cannot both get it.
 */
export function decideColor(current: unknown, uid: string, color: Color): Decision {
  const room = asRoom(current);
  if (!room) return deny('not-found');
  if (room.status !== 'waiting') return deny('already-started');
  if (!room.players[uid]) return deny('not-found');
  if (room.players[uid].color === color) return deny('nothing-to-do');

  const taken = Object.entries(room.players).some(
    ([other, player]) => other !== uid && player.color === color,
  );
  if (taken) return deny('color-taken');

  return allow({
    ...room,
    players: { ...room.players, [uid]: { ...room.players[uid], color } },
  });
}

/**
 * The host starts the game. Seats are baked into gameState.players, each
 * carrying the uid that owns it — that is what lets this client and the
 * Phase 4 security rules decide turn ownership from gameState alone.
 */
export function decideStart(
  current: unknown,
  uid: string,
  seatGame: (seats: { uid: string; name: string; color: Color }[]) => GameState,
): Decision {
  const room = asRoom(current);
  if (!room) return deny('not-found');
  if (room.hostId !== uid) return deny('not-host');
  if (room.status !== 'waiting') return deny('already-started');

  if (Object.keys(room.players).length < 2) return deny('not-enough-players');

  // Written back to the lobby seats as well, so the colour a player sees beside
  // their name is the colour they are about to play.
  const players = seatOppositeCorners(room.players, room.hostId);

  return allow({
    ...room,
    players,
    status: 'playing',
    gameState: forDatabase(seatGame(seatsOf(players))),
  });
}

/**
 * Apply one turn transition. `advance` is a pure engine call run against
 * whatever the server currently holds — not against the client's possibly stale
 * render — and the whole write is abandoned if this client no longer owns the turn.
 */
export function decideTurn(
  current: unknown,
  uid: string,
  advance: (state: GameState) => GameState,
): Decision {
  const room = asRoom(current);
  if (!room) return deny('not-found');
  if (room.status !== 'playing') return deny('already-started');

  const state = toGameState(room.gameState);
  if (!state) return deny('not-found');
  if (currentSeatUid(state) !== uid) return deny('not-your-turn');

  let next: GameState;
  try {
    next = advance(state);
  } catch {
    // The engine refused: the state moved under us, or the tap was stale.
    return deny('illegal-move');
  }

  const over = isGameOver(next);
  return allow({
    ...room,
    status: over ? 'finished' : 'playing',
    ...(over ? { endedReason: 'won' as const } : {}),
    gameState: forDatabase(next),
  });
}

/**
 * Play on without a player who has gone away. Any seated player may drive this
 * — the player whose turn it is obviously cannot, being disconnected — and it
 * is idempotent: once the turn has moved on, every other client's attempt
 * simply finds nothing to do and aborts.
 */
export function decideSkipTurn(current: unknown, uid: string, now: number): Decision {
  const room = asRoom(current);
  if (!room) return deny('not-found');
  if (room.status !== 'playing') return deny('nothing-to-do');
  if (!room.players[uid]) return deny('nothing-to-do'); // only players at the table

  const state = toGameState(room.gameState);
  if (!state || state.phase === 'game-over') return deny('nothing-to-do');

  const ownerUid = currentSeatUid(state);
  if (!ownerUid || ownerUid === uid) return deny('nothing-to-do');

  const owner = room.players[ownerUid];
  if (isPresent(owner)) return deny('nothing-to-do');
  if (awayFor(owner, now) < SKIP_GRACE_MS) return deny('nothing-to-do');

  // Skipping the last player still at the table would just spin the turn
  // around an empty room; that case is what decideAbandon is for.
  if (presentUids(room.players).length < 2) return deny('nothing-to-do');

  return allow({ ...room, gameState: forDatabase(skipTurn(state)) });
}

/**
 * Call the game off once it cannot be played: fewer than two players present,
 * and long enough for a brief network blip to have recovered.
 */
export function decideAbandon(current: unknown, uid: string, now: number): Decision {
  const room = asRoom(current);
  if (!room) return deny('not-found');
  if (room.status !== 'playing') return deny('nothing-to-do');
  if (!room.players[uid]) return deny('nothing-to-do');

  if (presentUids(room.players).length >= 2) return deny('nothing-to-do');

  const everyoneSettled = Object.values(room.players).every(
    (player) => isPresent(player) || awayFor(player, now) >= ABANDON_GRACE_MS,
  );
  if (!everyoneSettled) return deny('nothing-to-do');

  return allow({ ...room, status: 'finished', endedReason: 'abandoned' });
}
