import { describe, expect, it } from 'vitest';
import { rollDice } from '../../game/engine';
import { seatGame } from '../rooms';
import { toGameState, type RoomPlayer } from '../serialize';
import {
  ABANDON_GRACE_MS,
  SKIP_GRACE_MS,
  currentSeatUid,
  decideAbandon,
  decideSkipTurn,
  decideStart,
  decideTurn,
  isPresent,
  presentUids,
  type Decision,
  type StoredRoom,
} from '../roomLogic';

const NOW = 1_000_000;

const seat = (
  name: string,
  color: RoomPlayer['color'],
  presence: { away?: number | null } = {},
): RoomPlayer => {
  const player: RoomPlayer = { name, color, joinedAt: 1, connected: presence.away === undefined };
  if (presence.away !== undefined && presence.away !== null) {
    player.disconnectedAt = presence.away;
  }
  return player;
};

/** A room mid-game with the given seats; red (uid-a) is to move. */
function playing(players: Record<string, RoomPlayer>): StoredRoom {
  const base: StoredRoom = { hostId: 'uid-a', status: 'waiting', players, createdAt: 1 };
  const started = decideStart(base, 'uid-a', seatGame);
  if (!started.ok) throw new Error('setup failed');
  return { ...started.value, players };
}

const expectNothing = (decision: Decision) => {
  expect(decision.ok).toBe(false);
  if (!decision.ok) expect(decision.error).toBe('nothing-to-do');
};

describe('presence helpers', () => {
  it('treats a player with no presence field as present', () => {
    expect(isPresent({ name: 'A', color: 'red', joinedAt: 0 })).toBe(true);
    expect(isPresent(seat('A', 'red'))).toBe(true);
    expect(isPresent(seat('A', 'red', { away: NOW }))).toBe(false);
    expect(isPresent(undefined)).toBe(false);
  });

  it('counts only the players who are here', () => {
    const players = {
      'uid-a': seat('Ana', 'red'),
      'uid-b': seat('Bo', 'green', { away: NOW }),
      'uid-c': seat('Cy', 'yellow'),
    };
    expect(presentUids(players).sort()).toEqual(['uid-a', 'uid-c']);
  });
});

describe('skipping an absent player', () => {
  const threeSeats = (away: number | null) => ({
    'uid-a': seat('Ana', 'red', away === null ? {} : { away }),
    'uid-b': seat('Bo', 'green'),
    'uid-c': seat('Cy', 'yellow'),
  });

  it('does nothing while the player to move is still here', () => {
    expectNothing(decideSkipTurn(playing(threeSeats(null)), 'uid-b', NOW));
  });

  it('waits out the grace period before playing on', () => {
    const room = playing(threeSeats(NOW - SKIP_GRACE_MS + 1000));
    expectNothing(decideSkipTurn(room, 'uid-b', NOW));
  });

  it('passes the turn once the grace period has elapsed', () => {
    const room = playing(threeSeats(NOW - SKIP_GRACE_MS - 1));
    const before = toGameState(room.gameState)!;
    expect(currentSeatUid(before)).toBe('uid-a');

    const decision = decideSkipTurn(room, 'uid-b', NOW);
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;

    const after = toGameState(decision.value.gameState)!;
    expect(currentSeatUid(after)).toBe('uid-b');
    expect(after.lastEvent).toEqual({ type: 'skipped', color: 'red' });
    expect(after.phase).toBe('awaiting-roll');
    expect(after.version).toBeGreaterThan(before.version);
    // The absent player keeps their seat and their tokens.
    expect(after.players.map((p) => p.uid)).toEqual(['uid-a', 'uid-b', 'uid-c']);
  });

  it('is idempotent — a second client finds nothing left to do', () => {
    const room = playing(threeSeats(NOW - SKIP_GRACE_MS - 1));
    const first = decideSkipTurn(room, 'uid-b', NOW);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // uid-c races with the same intent against the already-updated room.
    expectNothing(decideSkipTurn(first.value, 'uid-c', NOW));
  });

  it('skips a player who vanished without a timestamp rather than stalling', () => {
    const players = threeSeats(null);
    players['uid-a'] = { name: 'Ana', color: 'red', joinedAt: 1, connected: false };
    expect(decideSkipTurn(playing(players), 'uid-b', NOW).ok).toBe(true);
  });

  it('will not let a player skip their own turn', () => {
    const room = playing(threeSeats(NOW - SKIP_GRACE_MS - 1));
    expectNothing(decideSkipTurn(room, 'uid-a', NOW));
  });

  it('ignores anyone who is not at the table', () => {
    const room = playing(threeSeats(NOW - SKIP_GRACE_MS - 1));
    expectNothing(decideSkipTurn(room, 'uid-stranger', NOW));
  });

  it('does not spin the turn around a table of one', () => {
    // Only uid-b is left; skipping would just cycle back to absent players.
    const players = {
      'uid-a': seat('Ana', 'red', { away: NOW - SKIP_GRACE_MS - 1 }),
      'uid-b': seat('Bo', 'green'),
      'uid-c': seat('Cy', 'yellow', { away: NOW - SKIP_GRACE_MS - 1 }),
    };
    expectNothing(decideSkipTurn(playing(players), 'uid-b', NOW));
  });

  it('leaves a finished room alone', () => {
    const room = playing(threeSeats(NOW - SKIP_GRACE_MS - 1));
    expectNothing(decideSkipTurn({ ...room, status: 'finished' }, 'uid-b', NOW));
  });
});

describe('abandoning a deserted table', () => {
  const twoSeats = (away: number | null) => ({
    'uid-a': seat('Ana', 'red'),
    'uid-b': seat('Bo', 'green', away === null ? {} : { away }),
  });

  it('does nothing while two players are present', () => {
    expectNothing(decideAbandon(playing(twoSeats(null)), 'uid-a', NOW));
  });

  it('waits out the longer grace period', () => {
    const room = playing(twoSeats(NOW - ABANDON_GRACE_MS + 5000));
    expectNothing(decideAbandon(room, 'uid-a', NOW));
  });

  it('ends the game once the table cannot be played', () => {
    const room = playing(twoSeats(NOW - ABANDON_GRACE_MS - 1));
    const decision = decideAbandon(room, 'uid-a', NOW);

    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.value.status).toBe('finished');
    expect(decision.value.endedReason).toBe('abandoned');
  });

  it('does not end a game that someone already won', () => {
    const room = playing(twoSeats(NOW - ABANDON_GRACE_MS - 1));
    expectNothing(
      decideAbandon({ ...room, status: 'finished', endedReason: 'won' }, 'uid-a', NOW),
    );
  });

  it('is idempotent once the room is already finished', () => {
    const room = playing(twoSeats(NOW - ABANDON_GRACE_MS - 1));
    const first = decideAbandon(room, 'uid-a', NOW);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expectNothing(decideAbandon(first.value, 'uid-a', NOW));
  });
});

describe('a player who leaves and comes back', () => {
  it('gets skipped, then plays again on their next turn', () => {
    const players = {
      'uid-a': seat('Ana', 'red', { away: NOW - SKIP_GRACE_MS - 1 }),
      'uid-b': seat('Bo', 'green'),
      'uid-c': seat('Cy', 'yellow'),
    };
    let room = playing(players);

    const skipped = decideSkipTurn(room, 'uid-b', NOW);
    expect(skipped.ok).toBe(true);
    if (!skipped.ok) return;
    room = skipped.value;
    expect(currentSeatUid(toGameState(room.gameState)!)).toBe('uid-b');

    // Ana reconnects — presence clears, and nothing about her seat changed.
    room = { ...room, players: { ...room.players, 'uid-a': seat('Ana', 'red') } };
    expectNothing(decideSkipTurn(room, 'uid-b', NOW));

    // Her seat, tokens and turn order all survived being skipped.
    const state = toGameState(room.gameState)!;
    expect(isPresent(room.players['uid-a'])).toBe(true);
    expect(state.players.map((p) => p.uid)).toEqual(['uid-a', 'uid-b', 'uid-c']);
    expect(state.players[0].tokens).toHaveLength(4);

    // And when the turn comes back round she may write again.
    const hers = { ...room, gameState: { ...state, turnIndex: 0 } };
    expect(decideTurn(hers, 'uid-a', rollDice).ok).toBe(true);
  });
});
