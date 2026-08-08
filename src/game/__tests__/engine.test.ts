import { describe, expect, it } from 'vitest';
import { FINISH, MAIN_TRACK_STEPS, absoluteTrackIndex, isSafeIndex } from '../board';
import {
  applyMove,
  createGame,
  currentTurn,
  getLegalMoves,
  isGameOver,
  rollDice,
  skipTurn,
  standings,
} from '../engine';
import { awaitingMove, findSeed, gameWith, progressOf } from './helpers';

describe('createGame', () => {
  it('seats 2-4 players in clockwise order with four tokens each in the yard', () => {
    const game = createGame(['yellow', 'red', 'green']);
    expect(game.players.map((p) => p.color)).toEqual(['red', 'green', 'yellow']);
    for (const player of game.players) {
      expect(player.tokens).toHaveLength(4);
      expect(player.tokens.every((t) => t.progress === 0)).toBe(true);
      expect(player.finished).toBe(false);
    }
    expect(game.phase).toBe('awaiting-roll');
    expect(game.dice).toBeNull();
    expect(currentTurn(game).color).toBe('red');
  });

  it('rejects impossible line-ups', () => {
    expect(() => createGame(['red'])).toThrow(/2 to 4/);
    expect(() => createGame(['red', 'red'])).toThrow(/distinct/);
  });

  it('produces a state that survives a JSON round-trip', () => {
    const game = createGame(['red', 'blue'], ['Ana', 'Bo'], 42);
    expect(JSON.parse(JSON.stringify(game))).toEqual(game);
  });
});

describe('leaving the yard', () => {
  it('opens the yard only on a 6, landing on the start square', () => {
    const game = createGame(['red', 'green'], [], findSeed([6]));
    const rolled = rollDice(game);

    expect(rolled.dice).toBe(6);
    expect(rolled.phase).toBe('awaiting-move');

    const moves = getLegalMoves(rolled);
    expect(moves).toHaveLength(4);
    expect(moves.every((m) => m.kind === 'leaveHome' && m.from === 0 && m.to === 1)).toBe(true);

    const moved = applyMove(rolled, 'red-0');
    expect(progressOf(moved, 'red-0')).toBe(1);
    expect(absoluteTrackIndex('red', 1)).toBe(0);
  });

  it('passes the turn when a non-6 leaves every token stuck in the yard', () => {
    const game = createGame(['red', 'green'], [], findSeed([3]));
    const rolled = rollDice(game);

    expect(rolled.phase).toBe('awaiting-roll');
    expect(rolled.dice).toBeNull();
    // The face still shows what came up, even though it could not be used.
    expect(rolled.lastRoll).toBe(3);
    expect(rolled.lastEvent).toEqual({ type: 'noLegalMove', color: 'red', value: 3 });
    expect(currentTurn(rolled).color).toBe('green');
  });

  it('will not stack a second token onto an occupied start square', () => {
    const game = awaitingMove(gameWith(['red', 'green'], { 'red-0': 1 }), 6);
    const movable = getLegalMoves(game).map((m) => m.tokenId);
    expect(movable).toEqual(['red-0']);
  });
});

describe('sixes', () => {
  it('grants another roll after moving on a 6', () => {
    const game = createGame(['red', 'green'], [], findSeed([6]));
    const moved = applyMove(rollDice(game), 'red-0');

    expect(currentTurn(moved).color).toBe('red');
    expect(moved.phase).toBe('awaiting-roll');
    expect(moved.consecutiveSixes).toBe(1);
  });

  it('re-rolls on a 6 that has no usable move', () => {
    // Every token home except one that would overshoot the center on a 6.
    const stuck = gameWith(['red', 'green'], {
      'red-0': FINISH,
      'red-1': FINISH,
      'red-2': FINISH,
      'red-3': 55,
    });
    const rolled = rollDice({ ...stuck, rngSeed: findSeed([6]) });

    expect(rolled.lastEvent).toEqual({ type: 'noLegalMove', color: 'red', value: 6 });
    expect(currentTurn(rolled).color).toBe('red');
    expect(rolled.consecutiveSixes).toBe(1);
  });

  it('forfeits the turn on a third consecutive 6 without applying its move', () => {
    const game = createGame(['red', 'green'], [], findSeed([6, 6, 6]));

    const first = applyMove(rollDice(game), 'red-0'); // red-0: yard -> 1
    expect(first.consecutiveSixes).toBe(1);

    const second = applyMove(rollDice(first), 'red-0'); // red-0: 1 -> 7
    expect(second.consecutiveSixes).toBe(2);
    expect(progressOf(second, 'red-0')).toBe(7);

    const third = rollDice(second);
    expect(third.lastEvent).toEqual({ type: 'threeSixes', color: 'red' });
    expect(third.phase).toBe('awaiting-roll');
    expect(third.consecutiveSixes).toBe(0);
    expect(currentTurn(third).color).toBe('green');
    // The third six's move was never applied.
    expect(progressOf(third, 'red-0')).toBe(7);
  });

  it('resets the six counter once the turn passes', () => {
    const game = createGame(['red', 'green'], [], findSeed([6, 2]));
    const afterSix = applyMove(rollDice(game), 'red-0');
    const afterTwo = applyMove(rollDice(afterSix), 'red-0');

    expect(afterTwo.consecutiveSixes).toBe(0);
    expect(currentTurn(afterTwo).color).toBe('green');
  });
});

describe('captures', () => {
  it('sends an opponent token on an unsafe square back to its yard', () => {
    // red progress 10 and green progress 49 are the same track square (index 9).
    expect(absoluteTrackIndex('red', 10)).toBe(absoluteTrackIndex('green', 49));
    expect(isSafeIndex(absoluteTrackIndex('red', 10)!)).toBe(false);

    const game = awaitingMove(
      gameWith(['red', 'green'], { 'red-0': 5, 'green-0': 49 }),
      5,
    );
    const move = getLegalMoves(game).find((m) => m.tokenId === 'red-0')!;
    expect(move.to).toBe(10);
    expect(move.captures).toEqual(['green-0']);

    const after = applyMove(game, 'red-0');
    expect(progressOf(after, 'red-0')).toBe(10);
    expect(progressOf(after, 'green-0')).toBe(0);
    expect(after.lastEvent).toEqual({ type: 'captured', by: 'red', tokenIds: ['green-0'] });
  });

  it('does not capture on a star square', () => {
    const target = absoluteTrackIndex('red', 9)!;
    expect(isSafeIndex(target)).toBe(true);
    expect(absoluteTrackIndex('green', 48)).toBe(target);

    const game = awaitingMove(
      gameWith(['red', 'green'], { 'red-0': 4, 'green-0': 48 }),
      5,
    );
    const move = getLegalMoves(game).find((m) => m.tokenId === 'red-0')!;
    expect(move.to).toBe(9);
    expect(move.captures).toEqual([]);

    const after = applyMove(game, 'red-0');
    expect(progressOf(after, 'green-0')).toBe(48);
  });

  it('does not capture on a colored start square', () => {
    // red progress 14 is green's own start square.
    expect(absoluteTrackIndex('red', 14)).toBe(absoluteTrackIndex('green', 1));

    const game = awaitingMove(
      gameWith(['red', 'green'], { 'red-0': 9, 'green-0': 1 }),
      5,
    );
    const move = getLegalMoves(game).find((m) => m.tokenId === 'red-0')!;
    expect(move.captures).toEqual([]);

    const after = applyMove(game, 'red-0');
    expect(progressOf(after, 'green-0')).toBe(1);
  });

  it('never captures inside a home column', () => {
    const game = awaitingMove(
      gameWith(['red', 'green'], { 'red-0': 50, 'green-0': 53 }),
      4,
    );
    const move = getLegalMoves(game).find((m) => m.tokenId === 'red-0')!;
    expect(move.to).toBe(54);
    expect(move.captures).toEqual([]);
    expect(progressOf(applyMove(game, 'red-0'), 'green-0')).toBe(53);
  });

  it('clears every opponent token sharing the landing square', () => {
    const game = awaitingMove(
      gameWith(['red', 'green', 'yellow'], {
        'red-0': 5,
        'green-0': 49,
        'green-1': 49,
        'yellow-0': 36, // (26 + 36 - 1) % 52 === 9, the same square
      }),
      5,
    );
    expect(absoluteTrackIndex('yellow', 36)).toBe(absoluteTrackIndex('red', 10));

    const after = applyMove(game, 'red-0');
    expect(progressOf(after, 'green-0')).toBe(0);
    expect(progressOf(after, 'green-1')).toBe(0);
    expect(progressOf(after, 'yellow-0')).toBe(0);
  });
});

describe('own tokens block', () => {
  it('refuses to land on a square held by a friendly token', () => {
    const game = awaitingMove(
      gameWith(['red', 'green'], { 'red-0': 10, 'red-1': 5 }),
      5,
    );
    const movable = getLegalMoves(game).map((m) => m.tokenId);
    expect(movable).not.toContain('red-1');
    expect(movable).toContain('red-0');
  });

  it('lets friendly tokens pile up on the center', () => {
    const game = awaitingMove(
      gameWith(['red', 'green'], { 'red-0': FINISH, 'red-1': 55 }),
      3,
    );
    const move = getLegalMoves(game).find((m) => m.tokenId === 'red-1')!;
    expect(move.kind).toBe('finish');
    expect(move.to).toBe(FINISH);
  });
});

describe('exact count to finish', () => {
  it('accepts the exact roll into the center', () => {
    const game = awaitingMove(gameWith(['red', 'green'], { 'red-0': 55 }), 3);
    const move = getLegalMoves(game).find((m) => m.tokenId === 'red-0')!;
    expect(move).toMatchObject({ from: 55, to: FINISH, kind: 'finish' });
  });

  it('refuses to move a token that would overshoot the center', () => {
    const game = awaitingMove(gameWith(['red', 'green'], { 'red-0': 55 }), 4);
    expect(getLegalMoves(game).map((m) => m.tokenId)).not.toContain('red-0');
  });

  it('lets a token step from the track into its home column', () => {
    const game = awaitingMove(gameWith(['red', 'green'], { 'red-0': MAIN_TRACK_STEPS }), 2);
    const move = getLegalMoves(game).find((m) => m.tokenId === 'red-0')!;
    expect(move.to).toBe(53);
    expect(move.kind).toBe('advance');
  });

  it('never moves a token that is already home', () => {
    const game = awaitingMove(gameWith(['red', 'green'], { 'red-0': FINISH }), 1);
    expect(getLegalMoves(game).map((m) => m.tokenId)).not.toContain('red-0');
  });
});

describe('turn order', () => {
  it('passes the turn when the roll has no legal move at all', () => {
    // Red's only loose token would overshoot on a 5; the rest are home.
    const stuck = gameWith(['red', 'green'], {
      'red-0': FINISH,
      'red-1': FINISH,
      'red-2': FINISH,
      'red-3': 55,
    });
    const rolled = rollDice({ ...stuck, rngSeed: findSeed([5]) });

    expect(rolled.lastEvent).toEqual({ type: 'noLegalMove', color: 'red', value: 5 });
    expect(currentTurn(rolled).color).toBe('green');
    expect(progressOf(rolled, 'red-3')).toBe(55);
  });

  it('skips players who have already brought every token home', () => {
    const game = awaitingMove(
      gameWith(
        ['red', 'green', 'yellow'],
        {
          'red-0': 5,
          'green-0': FINISH,
          'green-1': FINISH,
          'green-2': FINISH,
          'green-3': FINISH,
        },
        { winnerOrder: ['green'] },
      ),
      3,
    );
    const withFinishedGreen = {
      ...game,
      players: game.players.map((p) =>
        p.color === 'green' ? { ...p, finished: true } : p,
      ),
    };

    const after = applyMove(withFinishedGreen, 'red-0');
    expect(currentTurn(after).color).toBe('yellow');
  });

  it('refuses to roll while a move is pending, and to move before a roll', () => {
    const game = awaitingMove(gameWith(['red', 'green'], { 'red-0': 5 }), 3);
    expect(() => rollDice(game)).toThrow(/phase/);
    expect(() => applyMove({ ...game, phase: 'awaiting-roll' }, 'red-0')).toThrow(/phase/);
    expect(() => applyMove(game, 'red-1')).toThrow(/No legal move/);
  });
});

describe('the face on show', () => {
  it('records every roll, usable or not', () => {
    const game = createGame(['red', 'green'], [], findSeed([6, 3]));
    expect(game.lastRoll).toBeNull();

    const six = rollDice(game);
    expect(six.lastRoll).toBe(6);
    expect(six.dice).toBe(6);

    // Moving clears the pending roll but leaves the face alone.
    const moved = applyMove(six, 'red-0');
    expect(moved.dice).toBeNull();
    expect(moved.lastRoll).toBe(6);
  });

  it('keeps the face through a forfeited third six', () => {
    const game = createGame(['red', 'green'], [], findSeed([6, 6, 6]));
    const first = applyMove(rollDice(game), 'red-0');
    const second = applyMove(rollDice(first), 'red-0');
    const third = rollDice(second);

    expect(third.lastEvent).toEqual({ type: 'threeSixes', color: 'red' });
    expect(third.lastRoll).toBe(6);
  });
});

describe('skipping a turn', () => {
  it('hands the turn on without touching the board', () => {
    const game = gameWith(['red', 'green', 'yellow'], { 'red-0': 7, 'green-0': 3 });
    const after = skipTurn(game);

    expect(currentTurn(after).color).toBe('green');
    expect(after.phase).toBe('awaiting-roll');
    expect(after.dice).toBeNull();
    expect(after.lastEvent).toEqual({ type: 'skipped', color: 'red' });
    expect(progressOf(after, 'red-0')).toBe(7);
    expect(progressOf(after, 'green-0')).toBe(3);
    expect(after.version).toBeGreaterThan(game.version);
  });

  it('abandons a pending roll rather than applying it', () => {
    const game = awaitingMove(gameWith(['red', 'green'], { 'red-0': 5 }), 6);
    const after = skipTurn(game);

    expect(after.phase).toBe('awaiting-roll');
    expect(after.consecutiveSixes).toBe(0);
    expect(progressOf(after, 'red-0')).toBe(5);
    expect(currentTurn(after).color).toBe('green');
  });

  it('passes over players who have already finished', () => {
    const game = gameWith(
      ['red', 'green', 'yellow'],
      {
        'green-0': FINISH,
        'green-1': FINISH,
        'green-2': FINISH,
        'green-3': FINISH,
      },
      { winnerOrder: ['green'] },
    );
    const withFinished = {
      ...game,
      players: game.players.map((p) => (p.color === 'green' ? { ...p, finished: true } : p)),
    };
    expect(currentTurn(skipTurn(withFinished)).color).toBe('yellow');
  });

  it('refuses to skip once the game is over', () => {
    const game = gameWith(['red', 'green'], {}, { phase: 'game-over' });
    expect(() => skipTurn(game)).toThrow(/game is over/);
  });

  it('leaves the input state untouched', () => {
    const game = gameWith(['red', 'green'], { 'red-0': 4 });
    const snapshot = JSON.parse(JSON.stringify(game));
    skipTurn(game);
    expect(game).toEqual(snapshot);
  });
});

describe('winning', () => {
  it('ends a two-player game as soon as one player is fully home', () => {
    const game = awaitingMove(
      gameWith(['red', 'green'], {
        'red-0': FINISH,
        'red-1': FINISH,
        'red-2': FINISH,
        'red-3': 55,
      }),
      3,
    );
    expect(isGameOver(game)).toBe(false);

    const after = applyMove(game, 'red-3');
    expect(after.players[0].finished).toBe(true);
    expect(after.winnerOrder).toEqual(['red']);
    expect(isGameOver(after)).toBe(true);
    expect(after.phase).toBe('game-over');
    expect(after.lastEvent).toEqual({ type: 'playerWon', color: 'red', place: 1 });
    expect(standings(after)).toEqual(['red', 'green']);
  });

  it('keeps a three-player game running after first place', () => {
    const game = awaitingMove(
      gameWith(['red', 'green', 'yellow'], {
        'red-0': FINISH,
        'red-1': FINISH,
        'red-2': FINISH,
        'red-3': 52,
      }),
      6,
    );
    const after = applyMove(game, 'red-3');

    expect(after.winnerOrder).toEqual(['red']);
    expect(isGameOver(after)).toBe(false);
    expect(after.phase).toBe('awaiting-roll');
    // A finishing 6 does not buy another roll — there is nothing left to move.
    expect(currentTurn(after).color).toBe('green');
  });
});

describe('purity', () => {
  it('leaves the input state untouched', () => {
    const game = createGame(['red', 'green'], [], findSeed([6]));
    const snapshot = JSON.parse(JSON.stringify(game));

    const rolled = rollDice(game);
    applyMove(rolled, 'red-0');

    expect(game).toEqual(snapshot);
    expect(rolled.version).toBeGreaterThan(game.version);
  });
});

describe('full game simulation', () => {
  it('always reaches a winner within a sane number of turns', () => {
    for (let seed = 1; seed <= 25; seed++) {
      let state = createGame(['red', 'green', 'yellow', 'blue'], [], seed * 7919);
      let steps = 0;

      while (!isGameOver(state) && steps < 20_000) {
        steps++;
        if (state.phase === 'awaiting-roll') {
          state = rollDice(state);
        } else {
          const moves = getLegalMoves(state);
          expect(moves.length).toBeGreaterThan(0);
          // Prefer finishing, then capturing, then the furthest token.
          const pick =
            moves.find((m) => m.kind === 'finish') ??
            moves.find((m) => m.captures.length > 0) ??
            moves.reduce((a, b) => (b.from > a.from ? b : a));
          state = applyMove(state, pick.tokenId);
        }

        // Invariants that must hold after every single transition.
        for (const player of state.players) {
          const onTrack = new Map<number, number>();
          for (const token of player.tokens) {
            expect(token.progress).toBeGreaterThanOrEqual(0);
            expect(token.progress).toBeLessThanOrEqual(FINISH);
            const index = absoluteTrackIndex(player.color, token.progress);
            if (index !== null) {
              onTrack.set(index, (onTrack.get(index) ?? 0) + 1);
            }
          }
          // No two friendly tokens ever share a track square.
          for (const count of onTrack.values()) expect(count).toBe(1);
        }
      }

      expect(isGameOver(state)).toBe(true);
      expect(state.phase).toBe('game-over');
      expect(standings(state)).toHaveLength(4);
    }
  });
});
