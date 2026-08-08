/**
 * The Firebase side of room lifecycle and gameplay writes.
 *
 * The "current-player-writes" model means a client computes the next state with
 * the shared pure engine and writes it back. Every write runs inside a Realtime
 * Database transaction whose decision comes from `roomLogic.ts`, so turn
 * ownership and room status are re-checked against fresh server data — an
 * out-of-turn tap, a double tap, or a write racing another client is rejected
 * rather than applied.
 */

import { get, ref, runTransaction, serverTimestamp, update } from 'firebase/database';
import { DEFAULT_TOKEN_COUNT, SEATING_ORDER, isTokenCount } from '../game/board';
import { createGame } from '../game/engine';
import type { Color, GameState } from '../game/types';
import { getDb } from './firebase';
import {
  ABANDON_GRACE_MS,
  MAX_PLAYERS,
  ROOM_ERROR_TEXT,
  SKIP_GRACE_MS,
  currentSeatUid,
  decideAbandon,
  decideColor,
  decideJoin,
  decideSkipTurn,
  decideStart,
  decideTurn,
  freeColor,
  isPresent,
  presentUids,
  seatsOf,
  type Decision,
  type RoomError,
  type StoredRoom,
} from './roomLogic';
import { forDatabase, type Room, type RoomPlayer } from './serialize';

const CODE_LENGTH = 4;
/** No I/O/0/1 — these get read aloud and typed on phones. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type Result<T> =
  | { ok: true; value: T }
  /** `detail` carries the raw SDK message when the failure came from Firebase. */
  | { ok: false; error: RoomError; detail?: string };

const fail = <T>(error: RoomError, detail?: string): Result<T> => ({ ok: false, error, detail });
const done = <T>(value: T): Result<T> => ({ ok: true, value });

/** Turn a failed Result into something worth showing a player. */
export function explain(result: { error: RoomError; detail?: string }): string {
  const text = ROOM_ERROR_TEXT[result.error];
  return result.detail ? `${text} (${result.detail})` : text;
}

export function normalizeCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
}

function randomCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

/** Build the initial GameState with each seat bound to its owner's uid. */
export function seatGame(
  seats: { uid: string; name: string; color: Color }[],
  tokenCount: number = DEFAULT_TOKEN_COUNT,
): GameState {
  const byColor = new Map(seats.map((seat) => [seat.color, seat] as const));
  const base = createGame(
    seats.map((seat) => seat.color),
    seats.map((seat) => seat.name),
    undefined,
    tokenCount,
  );
  return {
    ...base,
    players: base.players.map((player) => ({
      ...player,
      name: byColor.get(player.color)?.name ?? player.name,
      uid: byColor.get(player.color)!.uid,
      connected: true,
    })),
  };
}

/**
 * Run a decision reducer inside a transaction and report the outcome.
 *
 * The write value goes through `forDatabase` because Realtime Database rejects
 * any `undefined` in a value by throwing — a failure mode that is otherwise
 * invisible, since it surfaces as a rejected promise rather than an aborted
 * transaction. For the same reason SDK throws (rules denials, network) are
 * caught here and returned as a Result rather than escaping.
 */
async function commit(
  roomId: string,
  decide: (current: unknown) => Decision,
): Promise<Result<void>> {
  let error: RoomError | null = null;

  try {
    const result = await runTransaction(ref(getDb(), `rooms/${roomId}`), (current) => {
      const decision = decide(current);
      if (!decision.ok) {
        error = decision.error;
        return undefined; // abort the transaction
      }
      error = null;
      return forDatabase(decision.value);
    });

    if (!result.committed) return fail(error ?? 'not-found');
    return done(undefined);
  } catch (thrown) {
    return { ok: false, error: error ?? 'write-failed', detail: message(thrown) };
  }
}

function message(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

/**
 * Claim an unused room code and seat the host. The transaction returning
 * `undefined` for an occupied code is what makes the claim atomic — two people
 * creating a room at the same instant cannot land on the same code.
 */
export async function createRoom(
  uid: string,
  name: string,
  tokenCount: number = DEFAULT_TOKEN_COUNT,
): Promise<Result<string>> {
  const tokens = isTokenCount(tokenCount) ? tokenCount : DEFAULT_TOKEN_COUNT;
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode();
    try {
      const result = await runTransaction(ref(getDb(), `rooms/${code}`), (current) => {
        if (current !== null) return undefined; // taken — try another code
        return {
          hostId: uid,
          status: 'waiting',
          players: {
            [uid]: { name, color: SEATING_ORDER[0], joinedAt: Date.now(), connected: true },
          },
          createdAt: serverTimestamp(),
          tokenCount: tokens,
        };
      });
      if (result.committed) return done(code);
    } catch (thrown) {
      // A rules denial or network failure will not fix itself on the next code.
      return fail('write-failed', message(thrown));
    }
  }
  return fail('no-code');
}

/**
 * Check a room can be entered, before navigating to it.
 *
 * This is a plain read rather than a transaction on purpose. A transaction
 * whose callback is first handed `null` — which is what happens when nothing
 * for that path is cached locally — aborts on the spot and never consults the
 * server. That is why typing a code used to report "no room with that code"
 * while opening an invite link worked: the link renders the room first, and its
 * subscription has the data by the time the join runs.
 */
export async function inspectRoom(roomId: string, uid: string): Promise<Result<void>> {
  let room: StoredRoom | null;
  try {
    const snapshot = await get(ref(getDb(), `rooms/${roomId}`));
    room = snapshot.exists() ? (snapshot.val() as StoredRoom) : null;
  } catch (thrown) {
    return fail('write-failed', message(thrown));
  }

  if (!room) return fail('not-found');

  const players = room.players ?? {};
  if (players[uid]) return done(undefined); // already seated: rejoining
  if (room.status !== 'waiting') return fail('already-started');
  if (Object.keys(players).length >= MAX_PLAYERS) return fail('room-full');
  return done(undefined);
}

/**
 * Take a seat. Called from inside the room, where the live subscription means
 * the transaction starts from real data rather than an empty cache.
 */
export async function joinRoom(
  roomId: string,
  uid: string,
  name: string,
): Promise<Result<string>> {
  const result = await commit(roomId, (current) => decideJoin(current, uid, name));
  return result.ok ? done(roomId) : fail(result.error, result.detail);
}

export function startGame(roomId: string, uid: string): Promise<Result<void>> {
  return commit(roomId, (current) => decideStart(current, uid, seatGame));
}

export function commitTurn(
  roomId: string,
  uid: string,
  advance: (state: GameState) => GameState,
): Promise<Result<void>> {
  return commit(roomId, (current) => decideTurn(current, uid, advance));
}

/**
 * Presence housekeeping, run on a timer by every connected client. Both are
 * idempotent and abort cheaply, so several clients racing costs nothing.
 */
export function skipAbsentTurn(
  roomId: string,
  uid: string,
  now: number,
): Promise<Result<void>> {
  return commit(roomId, (current) => decideSkipTurn(current, uid, now));
}

export function abandonIfDeserted(
  roomId: string,
  uid: string,
  now: number,
): Promise<Result<void>> {
  return commit(roomId, (current) => decideAbandon(current, uid, now));
}

/** Take a different colour while the room is still in the lobby. */
export function setPlayerColor(
  roomId: string,
  uid: string,
  color: Color,
): Promise<Result<void>> {
  return commit(roomId, (current) => decideColor(current, uid, color));
}

/** Update your own display name on a room you are seated in. */
export async function setPlayerName(roomId: string, uid: string, name: string): Promise<void> {
  await update(ref(getDb(), `rooms/${roomId}/players/${uid}`), { name });
}

export {
  ABANDON_GRACE_MS,
  MAX_PLAYERS,
  ROOM_ERROR_TEXT,
  SKIP_GRACE_MS,
  currentSeatUid,
  freeColor,
  isPresent,
  presentUids,
  seatsOf,
};
export type { Room, RoomError, RoomPlayer };
