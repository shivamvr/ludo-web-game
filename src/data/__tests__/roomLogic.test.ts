import { describe, expect, it } from 'vitest';
import { FINISH, OPPOSITE_CORNER } from '../../game/board';
import { applyMove, getLegalMoves, isGameOver, rollDice } from '../../game/engine';
import type { GameState } from '../../game/types';
import { seatGame } from '../rooms';
import { forDatabase, toGameState, type RoomPlayer } from '../serialize';
import {
  currentSeatUid,
  decideColor,
  decideJoin,
  decideStart,
  decideTurn,
  type Decision,
  type StoredRoom,
} from '../roomLogic';
import { FakeRoomNode } from './rtdb';
import { awaitingMove, gameWith } from '../../game/__tests__/helpers';

const player = (name: string, color: RoomPlayer['color'], joinedAt = 1): RoomPlayer => ({
  name,
  color,
  joinedAt,
  connected: true,
});

const waitingRoom = (players: Record<string, RoomPlayer>): StoredRoom => ({
  hostId: 'uid-a',
  status: 'waiting',
  players,
  createdAt: 1,
});

/** Play whatever the engine offers first, spending the number that move names. */
const advance = (s: GameState): GameState => {
  if (s.phase === 'awaiting-roll') return rollDice(s);
  const move = getLegalMoves(s)[0];
  return applyMove(s, move.tokenId, move.die);
};

const expectDenied = (decision: Decision, error: string) => {
  expect(decision.ok).toBe(false);
  if (!decision.ok) expect(decision.error).toBe(error);
};

/**
 * Realtime Database throws on any `undefined` inside a value it is asked to
 * store, and a transaction handler's return value is exactly such a value. A
 * reducer that lets `undefined` through therefore fails at the SDK boundary
 * rather than at the assertion — so every decision is checked for it.
 */
function expectNoUndefined(value: unknown, path = 'room'): void {
  if (value === undefined) throw new Error(`undefined at ${path}`);
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    expect(child, `${path}.${key} must not be undefined`).not.toBeUndefined();
    expectNoUndefined(child, `${path}.${key}`);
  }
}

const expectWritable = (decision: Decision) => {
  expect(decision.ok).toBe(true);
  if (decision.ok) expectNoUndefined(decision.value);
};

describe('joining', () => {
  it('refuses a room that does not exist', () => {
    expectDenied(decideJoin(null, 'uid-b', 'Bo'), 'not-found');
  });

  it('never returns a value containing undefined', () => {
    // A waiting room has no gameState; carrying `gameState: undefined` into the
    // write is what silently broke joining over a real database.
    const room = waitingRoom({ 'uid-a': player('Ana', 'red') });
    expectWritable(decideJoin(room, 'uid-b', 'Bo'));
    expectWritable(decideJoin(room, 'uid-a', 'Ana'));
    expectWritable(decideStart({ ...room, players: {
      'uid-a': player('Ana', 'red'), 'uid-b': player('Bo', 'green'),
    } }, 'uid-a', seatGame));
  });

  it('seats a new player in the next free color', () => {
    const room = waitingRoom({ 'uid-a': player('Ana', 'red') });
    const decision = decideJoin(room, 'uid-b', 'Bo', 50);

    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.value.players['uid-b']).toEqual({
      name: 'Bo',
      color: 'yellow',
      joinedAt: 50,
      connected: true,
    });
    // The existing seat is untouched.
    expect(decision.value.players['uid-a'].color).toBe('red');
  });

  it('seats arrivals across the board first, then refuses a fifth player', () => {
    let room = waitingRoom({ 'uid-a': player('Ana', 'red') });
    // The second seat is red's opposite corner, not its neighbour, so a game
    // that stops at two players is played diagonally.
    for (const [uid, color] of [
      ['uid-b', 'yellow'],
      ['uid-c', 'green'],
      ['uid-d', 'blue'],
    ] as const) {
      const decision = decideJoin(room, uid, uid);
      expect(decision.ok).toBe(true);
      if (!decision.ok) return;
      expect(decision.value.players[uid].color).toBe(color);
      room = decision.value;
    }
    expectDenied(decideJoin(room, 'uid-e', 'Eve'), 'room-full');
  });

  it('turns away newcomers once the game has started', () => {
    const room: StoredRoom = { ...waitingRoom({ 'uid-a': player('Ana', 'red') }), status: 'playing' };
    expectDenied(decideJoin(room, 'uid-b', 'Bo'), 'already-started');
  });

  it('lets a seated player back in mid-game, so a refresh keeps their seat', () => {
    const room: StoredRoom = {
      ...waitingRoom({ 'uid-a': player('Ana', 'red'), 'uid-b': player('Bo', 'green') }),
      status: 'playing',
    };
    const decision = decideJoin(room, 'uid-b', 'Bo');

    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.value.players['uid-b'].color).toBe('green');
  });
});

describe('choosing a colour', () => {
  const room = waitingRoom({
    'uid-a': player('Ana', 'red'),
    'uid-b': player('Bo', 'green'),
  });

  it('takes a free colour', () => {
    const decision = decideColor(room, 'uid-b', 'blue');
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.value.players['uid-b'].color).toBe('blue');
    expect(decision.value.players['uid-a'].color).toBe('red');
    expectNoUndefined(decision.value);
  });

  it('refuses a colour someone else holds', () => {
    expectDenied(decideColor(room, 'uid-b', 'red'), 'color-taken');
  });

  it('does nothing when you already have it', () => {
    expectDenied(decideColor(room, 'uid-b', 'green'), 'nothing-to-do');
  });

  it('refuses once the game is under way', () => {
    expectDenied(decideColor({ ...room, status: 'playing' }, 'uid-b', 'blue'), 'already-started');
  });

  it('ignores anyone not at the table', () => {
    expectDenied(decideColor(room, 'uid-stranger', 'blue'), 'not-found');
  });
});

describe('starting', () => {
  const twoSeats = waitingRoom({
    'uid-a': player('Ana', 'red'),
    'uid-b': player('Bo', 'green'),
  });

  it('only lets the host start', () => {
    expectDenied(decideStart(twoSeats, 'uid-b', seatGame), 'not-host');
  });

  it('needs at least two players', () => {
    const alone = waitingRoom({ 'uid-a': player('Ana', 'red') });
    expectDenied(decideStart(alone, 'uid-a', seatGame), 'not-enough-players');
  });

  it('refuses to start twice', () => {
    const started: StoredRoom = { ...twoSeats, status: 'playing' };
    expectDenied(decideStart(started, 'uid-a', seatGame), 'already-started');
  });

  it('binds each seat to its owner and starts play', () => {
    const decision = decideStart(twoSeats, 'uid-a', seatGame);
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;

    expect(decision.value.status).toBe('playing');
    const state = toGameState(decision.value.gameState)!;
    expect(state.players.map((p) => [p.color, p.uid, p.name])).toEqual([
      ['red', 'uid-a', 'Ana'],
      ['yellow', 'uid-b', 'Bo'],
    ]);
    expect(currentSeatUid(state)).toBe('uid-a');
  });

  it('puts two players on opposite corners, keeping the host where they are', () => {
    // Adjacent seats: red is bottom-left, green top-left. Bo moves across to
    // red's opposite corner rather than Ana being shifted.
    const decision = decideStart(twoSeats, 'uid-a', seatGame);
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;

    expect(decision.value.players['uid-a'].color).toBe('red');
    expect(decision.value.players['uid-b'].color).toBe('yellow');
    expect(OPPOSITE_CORNER[decision.value.players['uid-a'].color]).toBe(
      decision.value.players['uid-b'].color,
    );
  });

  it('leaves a two-player table that is already across the board alone', () => {
    const across = waitingRoom({
      'uid-a': player('Ana', 'green'),
      'uid-b': player('Bo', 'blue'),
    });
    const decision = decideStart(across, 'uid-a', seatGame);
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;

    expect(decision.value.players['uid-a'].color).toBe('green');
    expect(decision.value.players['uid-b'].color).toBe('blue');
  });

  it("deals the room's token count to every seat", () => {
    for (const count of [4, 6, 8]) {
      const decision = decideStart({ ...twoSeats, tokenCount: count }, 'uid-a', seatGame);
      expect(decision.ok).toBe(true);
      if (!decision.ok) return;

      const state = toGameState(decision.value.gameState)!;
      for (const player of state.players) {
        expect(player.tokens).toHaveLength(count);
      }
    }
  });

  it('falls back to four when the room predates the setting or stores nonsense', () => {
    for (const stored of [undefined, 3, 99, 'six']) {
      const room = stored === undefined ? twoSeats : { ...twoSeats, tokenCount: stored };
      const decision = decideStart(room, 'uid-a', seatGame);
      expect(decision.ok).toBe(true);
      if (!decision.ok) return;
      expect(toGameState(decision.value.gameState)!.players[0].tokens).toHaveLength(4);
    }
  });

  it('leaves three players as they are', () => {
    const three = waitingRoom({
      'uid-a': player('Ana', 'red'),
      'uid-b': player('Bo', 'green'),
      'uid-c': player('Cy', 'yellow'),
    });
    const decision = decideStart(three, 'uid-a', seatGame);
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;

    expect(Object.values(decision.value.players).map((p) => p.color).sort()).toEqual([
      'green',
      'red',
      'yellow',
    ]);
  });

  it('seats players in clockwise order regardless of join order', () => {
    const room = waitingRoom({
      'uid-c': player('Cy', 'yellow', 3),
      'uid-a': player('Ana', 'red', 1),
      'uid-b': player('Bo', 'green', 2),
    });
    const decision = decideStart(room, 'uid-a', seatGame);
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;

    const state = toGameState(decision.value.gameState)!;
    expect(state.players.map((p) => p.color)).toEqual(['red', 'green', 'yellow']);
  });
});

describe('turn writes', () => {
  function playingRoom(): StoredRoom {
    const decision = decideStart(
      waitingRoom({ 'uid-a': player('Ana', 'red'), 'uid-b': player('Bo', 'green') }),
      'uid-a',
      seatGame,
    );
    if (!decision.ok) throw new Error('setup failed');
    return decision.value;
  }

  it('rejects a write from a player who is not to move', () => {
    expectDenied(decideTurn(playingRoom(), 'uid-b', rollDice), 'not-your-turn');
  });

  it('rejects a write from someone with no seat at all', () => {
    expectDenied(decideTurn(playingRoom(), 'uid-stranger', rollDice), 'not-your-turn');
  });

  it('carries an earned roll across the write that lands in between', () => {
    // Online, every move is written out and read back before the next one. A
    // reward banked on one move and taken on the next has to survive that trip.
    const start = awaitingMove(
      gameWith(['red', 'green'], { 'red-0': FINISH - 2, 'red-1': 10 }),
      [6, 2],
    );
    const seated: GameState = {
      ...start,
      players: start.players.map((p, i) => ({
        ...p,
        uid: i === 0 ? 'uid-a' : 'uid-b',
        connected: true,
      })),
    };
    const room: StoredRoom = {
      ...waitingRoom({
        'uid-a': player('Ana', 'red'),
        'uid-b': player('Bo', 'green'),
      }),
      status: 'playing',
      gameState: forDatabase(seated),
    };

    // Finish a token with the 2, leaving the 6 in hand.
    const first = decideTurn(room, 'uid-a', (s) => applyMove(s, 'red-0', 2));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(toGameState(first.value.gameState)!.bonusRolls).toBe(1);

    // Spend the 6 — the turn must stay with red for the roll it earned.
    const second = decideTurn(first.value, 'uid-a', (s) => applyMove(s, 'red-1', 6));
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const end = toGameState(second.value.gameState)!;
    expect(end.dice).toEqual([]);
    expect(end.bonusRolls).toBe(1);
    expect(currentSeatUid(end)).toBe('uid-a');
  });

  it('rejects writes once the room is finished', () => {
    const room: StoredRoom = { ...playingRoom(), status: 'finished' };
    expectDenied(decideTurn(room, 'uid-a', rollDice), 'already-started');
  });

  it('turns an engine refusal into an error instead of a corrupt write', () => {
    const room = playingRoom();
    const state = toGameState(room.gameState)!;
    // Red has rolled a 6 and owes a move.
    const pending: StoredRoom = {
      ...room,
      gameState: { ...state, phase: 'awaiting-move', dice: 6 },
    };

    // Rolling again while a move is pending — the engine throws, and the
    // transaction must abort rather than store anything.
    expectDenied(decideTurn(pending, 'uid-a', rollDice), 'illegal-move');

    // Moving a token that has no legal move is refused the same way, whether it
    // belongs to the mover or to an opponent.
    expectDenied(decideTurn(pending, 'uid-a', (s) => applyMove(s, 'green-0')), 'illegal-move');
    expectDenied(decideTurn(pending, 'uid-a', (s) => applyMove(s, 'nope-9')), 'illegal-move');
  });

  it('marks the room finished when the game ends', () => {
    const room = playingRoom();
    const state = toGameState(room.gameState)!;
    // Hand red three tokens home and one a single step short of the center.
    const nearlyWon: GameState = {
      ...state,
      phase: 'awaiting-move',
      dice: [1],
      players: state.players.map((p) =>
        p.color === 'red'
          ? { ...p, tokens: p.tokens.map((t, i) => ({ ...t, progress: i < 3 ? FINISH : FINISH - 1 })) }
          : p,
      ),
    };

    const decision = decideTurn(
      { ...room, gameState: nearlyWon },
      'uid-a',
      (s) => applyMove(s, 'red-3', 1),
    );
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.value.status).toBe('finished');
    expect(isGameOver(toGameState(decision.value.gameState)!)).toBe(true);
  });
});

describe('a full game across three clients', () => {
  it('lets only the seat owner write, and reaches a winner', () => {
    const node = new FakeRoomNode();
    const uids = ['uid-a', 'uid-b', 'uid-c'];

    // Host creates, the others join.
    node.write(waitingRoom({ 'uid-a': player('Ana', 'red') }));
    for (const uid of ['uid-b', 'uid-c']) {
      const decision = decideJoin(node.read(), uid, uid);
      expect(decision.ok).toBe(true);
      if (decision.ok) node.write(decision.value);
    }

    const started = decideStart(node.read(), 'uid-a', seatGame);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    node.write(started.value);

    let writes = 0;
    let rejections = 0;

    for (let step = 0; step < 20_000; step++) {
      const room = node.read() as StoredRoom;
      const state = toGameState(room.gameState)!;
      if (isGameOver(state)) break;

      const owner = currentSeatUid(state)!;

      // Every other client tries the same write first — all must be refused.
      for (const uid of uids.filter((u) => u !== owner)) {
        const denied = decideTurn(room, uid, advance);
        expect(denied.ok).toBe(false);
        rejections++;
      }

      const decision = decideTurn(room, owner, advance);
      expect(decision.ok).toBe(true);
      if (!decision.ok) return;
      node.write(decision.value);
      writes++;
    }

    const final = node.read() as StoredRoom;
    const state = toGameState(final.gameState)!;
    expect(isGameOver(state)).toBe(true);
    expect(final.status).toBe('finished');
    expect(state.winnerOrder.length).toBe(2);
    expect(writes).toBeGreaterThan(100);
    expect(rejections).toBe(writes * 2);

    // Nothing more can be written to a finished room.
    expectDenied(decideTurn(final, currentSeatUid(state) ?? 'uid-a', rollDice), 'already-started');
  });

  it('ignores a stale write built from an out-of-date snapshot', () => {
    const node = new FakeRoomNode();
    node.write(waitingRoom({ 'uid-a': player('Ana', 'red'), 'uid-b': player('Bo', 'green') }));
    const started = decideStart(node.read(), 'uid-a', seatGame);
    if (!started.ok) throw new Error('setup failed');
    node.write(started.value);

    // Red holds an old snapshot, then plays a full turn.
    const stale = node.read();
    let room = node.read() as StoredRoom;
    for (let i = 0; i < 6; i++) {
      const state = toGameState(room.gameState)!;
      if (currentSeatUid(state) !== 'uid-a') break;
      const decision = decideTurn(
        room,
        'uid-a',
        (s) => advance(s),
      );
      if (!decision.ok) break;
      node.write(decision.value);
      room = node.read() as StoredRoom;
    }

    // The transaction re-reads the live value, so the stale snapshot cannot be
    // the basis of a write — replaying against fresh data is what actually happens.
    const live = node.read() as StoredRoom;
    expect(toGameState(live.gameState)!.version).toBeGreaterThan(
      toGameState((stale as StoredRoom).gameState)!.version,
    );
    expect(currentSeatUid(toGameState(live.gameState)!)).toBe('uid-b');
    expectDenied(decideTurn(live, 'uid-a', rollDice), 'not-your-turn');
  });
});
