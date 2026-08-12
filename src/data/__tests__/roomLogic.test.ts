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
  decideRematchRules,
  decideRematchStart,
  decideRematchVote,
  decideStart,
  decideTurn,
  type Decision,
  type StoredRematch,
  type StoredRoom,
} from '../roomLogic';
import { FakeRoomNode } from './rtdb';
import { awaitingMove, findSeed, gameWith } from '../../game/__tests__/helpers';

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

    // Finish a token with the 2. The roll it earns is due at once, and the 6
    // has to still be in hand on the far side of the write.
    const first = decideTurn(room, 'uid-a', (s) => applyMove(s, 'red-0', 2));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const mid = toGameState(first.value.gameState)!;
    expect(mid.bonusRolls).toBe(1);
    expect(mid.phase).toBe('awaiting-roll');
    expect(mid.dice).toEqual([6]);
    expect(currentSeatUid(mid)).toBe('uid-a');

    // Take it — the new number joins the 6 rather than replacing it.
    const second = decideTurn(first.value, 'uid-a', (s) =>
      rollDice({ ...s, rngSeed: findSeed([1]) }),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const end = toGameState(second.value.gameState)!;
    expect(end.dice).toEqual([6, 1]);
    expect(end.bonusRolls).toBe(0);
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

describe('rematching', () => {
  const finished = (
    players: Record<string, RoomPlayer>,
    extra: Partial<StoredRoom> = {},
  ): StoredRoom => ({
    hostId: 'uid-a',
    status: 'finished',
    players,
    createdAt: 1,
    endedReason: 'won',
    tokenCount: 4,
    yardExit: 'six',
    ...extra,
  });

  const table = () =>
    finished({
      'uid-a': player('Ana', 'red'),
      'uid-b': player('Bo', 'yellow'),
      'uid-c': player('Cy', 'green'),
    });

  it('is only on offer once the game is over', () => {
    const playing = { ...table(), status: 'playing' as const };
    expectDenied(decideRematchVote(playing, 'uid-b', 'in'), 'nothing-to-do');
    expectDenied(decideRematchRules(playing, 'uid-a', 6, 'one-or-six'), 'nothing-to-do');
    expectDenied(decideRematchStart(playing, 'uid-a', seatGame), 'already-started');
  });

  it('records an answer, and lets it be changed', () => {
    const asked = decideRematchVote(table(), 'uid-b', 'in');
    expectWritable(asked);
    if (!asked.ok) return;
    expect((asked.value.rematch as StoredRematch).votes).toEqual({ 'uid-b': 'in' });

    const reconsidered = decideRematchVote(asked.value, 'uid-b', 'out');
    expect(reconsidered.ok).toBe(true);
    if (!reconsidered.ok) return;
    expect((reconsidered.value.rematch as StoredRematch).votes).toEqual({ 'uid-b': 'out' });

    // Tapping the same answer twice is not a write worth making.
    expectDenied(decideRematchVote(reconsidered.value, 'uid-b', 'out'), 'nothing-to-do');
  });

  it('starts an offer at the rules just played', () => {
    const room = finished({ 'uid-a': player('Ana', 'red') }, {
      tokenCount: 7,
      yardExit: 'one-or-six',
    });
    const decision = decideRematchVote(room, 'uid-a', 'in');
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;

    const rematch = decision.value.rematch as StoredRematch;
    expect(rematch.tokenCount).toBe(7);
    expect(rematch.yardExit).toBe('one-or-six');
  });

  it('turns away anyone who is not at the table', () => {
    expectDenied(decideRematchVote(table(), 'uid-stranger', 'in'), 'not-found');
    expectDenied(decideRematchRules(table(), 'uid-b', 6, 'six'), 'not-host');
    expectDenied(decideRematchStart(table(), 'uid-b', seatGame), 'not-host');
  });

  it('lets the host change the rules without touching the finished game', () => {
    const decision = decideRematchRules(table(), 'uid-a', 8, 'one-or-six');
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;

    expect((decision.value.rematch as StoredRematch).tokenCount).toBe(8);
    expect((decision.value.rematch as StoredRematch).yardExit).toBe('one-or-six');
    // The game that was played keeps the rules it was played under.
    expect(decision.value.tokenCount).toBe(4);
    expect(decision.value.yardExit).toBe('six');
  });

  it('refuses rules the board cannot be built from', () => {
    expectDenied(decideRematchRules(table(), 'uid-a', 3, 'six'), 'nothing-to-do');
    expectDenied(
      decideRematchRules(table(), 'uid-a', 4, 'whenever' as never),
      'nothing-to-do',
    );
  });

  it('needs somebody else in before it can start', () => {
    expectDenied(decideRematchStart(table(), 'uid-a', seatGame), 'not-enough-players');

    const declined = decideRematchVote(table(), 'uid-b', 'out');
    if (!declined.ok) throw new Error('setup failed');
    expectDenied(decideRematchStart(declined.value, 'uid-a', seatGame), 'not-enough-players');
  });

  it('seats only the players who said they were in', () => {
    let room: StoredRoom = table();
    for (const [uid, vote] of [['uid-b', 'in'], ['uid-c', 'out']] as const) {
      const decision = decideRematchVote(room, uid, vote);
      if (!decision.ok) throw new Error('setup failed');
      room = decision.value;
    }

    const decision = decideRematchStart(room, 'uid-a', seatGame);
    expectWritable(decision);
    if (!decision.ok) return;

    expect(decision.value.status).toBe('playing');
    const state = toGameState(decision.value.gameState)!;
    expect(state.players.map((p) => p.uid)).toEqual(['uid-a', 'uid-b']);
    // Cy keeps their seat at the table and watches.
    expect(Object.keys(decision.value.players).sort()).toEqual(['uid-a', 'uid-b', 'uid-c']);
    expect(decision.value.players['uid-c'].color).toBe('green');
  });

  it('plays the new game by the host\u2019s rules and forgets the old one', () => {
    let room: StoredRoom = table();
    for (const step of [
      (r: StoredRoom) => decideRematchRules(r, 'uid-a', 6, 'one-or-six'),
      (r: StoredRoom) => decideRematchVote(r, 'uid-b', 'in'),
    ]) {
      const decision = step(room);
      if (!decision.ok) throw new Error('setup failed');
      room = decision.value;
    }

    const decision = decideRematchStart(room, 'uid-a', seatGame);
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;

    expect(decision.value.tokenCount).toBe(6);
    expect(decision.value.yardExit).toBe('one-or-six');
    expect(decision.value.endedReason).toBeUndefined();
    expect(decision.value.rematch).toBeUndefined();

    const state = toGameState(decision.value.gameState)!;
    expect(state.version).toBe(0);
    expect(state.phase).toBe('awaiting-roll');
    expect(state.yardExit).toBe('one-or-six');
    for (const seat of state.players) expect(seat.tokens).toHaveLength(6);
  });

  it('can be played through and then rematched again', () => {
    const node = new FakeRoomNode();
    node.write(table());

    const joined = decideRematchVote(node.read(), 'uid-b', 'in');
    if (!joined.ok) throw new Error('setup failed');
    node.write(joined.value);

    const started = decideRematchStart(node.read(), 'uid-a', seatGame);
    if (!started.ok) throw new Error('setup failed');
    node.write(started.value);

    // The room is a live game again: turns are owned, and the offer is gone.
    const live = node.read() as StoredRoom;
    expect(live.status).toBe('playing');
    expectDenied(decideRematchVote(live, 'uid-b', 'in'), 'nothing-to-do');
    expectDenied(decideTurn(live, 'uid-b', rollDice), 'not-your-turn');
    expect(decideTurn(live, 'uid-a', rollDice).ok).toBe(true);
  });
});
