import { describe, expect, it } from 'vitest';
import {
  FINISH,
  MAIN_TRACK_STEPS,
  START_INDEX,
  TOKEN_COUNTS,
  absoluteTrackIndex,
  isSafeIndex,
} from '../board';
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
    expect(game.dice).toEqual([]);
    expect(currentTurn(game).color).toBe('red');
  });

  it('rejects impossible line-ups', () => {
    expect(() => createGame(['red'])).toThrow(/2 to 4/);
    expect(() => createGame(['red', 'red'])).toThrow(/distinct/);
    expect(() => createGame(['red', 'green'], [], 1, 3)).toThrow(/Tokens per player/);
    expect(() => createGame(['red', 'green'], [], 1, 9)).toThrow(/Tokens per player/);
  });

  it('deals every player the chosen number of tokens, with distinct ids', () => {
    for (const count of TOKEN_COUNTS) {
      const game = createGame(['red', 'green', 'blue'], [], 1, count);
      const ids = new Set<string>();
      for (const player of game.players) {
        expect(player.tokens).toHaveLength(count);
        for (const token of player.tokens) {
          expect(token.progress).toBe(0);
          expect(token.color).toBe(player.color);
          ids.add(token.id);
        }
      }
      expect(ids.size).toBe(count * game.players.length);
    }
  });

  it('needs every token home before a player is finished, whatever the count', () => {
    const count = 6;
    let game = createGame(['red', 'green'], [], 1, count);
    // All but one token home: still playing.
    game = {
      ...game,
      players: game.players.map((p, i) =>
        i === 0
          ? { ...p, tokens: p.tokens.map((t, j) => (j === 0 ? t : { ...t, progress: FINISH })) }
          : p,
      ),
    };
    expect(game.players[0].tokens.filter((t) => t.progress === FINISH)).toHaveLength(count - 1);
    expect(isGameOver(game)).toBe(false);
  });

  it('produces a state that survives a JSON round-trip', () => {
    const game = createGame(['red', 'blue'], ['Ana', 'Bo'], 42);
    expect(JSON.parse(JSON.stringify(game))).toEqual(game);
  });
});

describe('leaving the yard', () => {
  it('opens the yard only on a 6, landing on the start square', () => {
    // A six is held rather than played, so the hand is only complete after the
    // follow-up roll.
    const game = createGame(['red', 'green'], [], findSeed([6, 3]));
    const rolled = rollDice(rollDice(game));

    expect(rolled.dice).toEqual([6, 3]);
    expect(rolled.phase).toBe('awaiting-move');

    // Only the six opens the yard; the three can do nothing from there.
    const moves = getLegalMoves(rolled);
    expect(moves).toHaveLength(4);
    expect(
      moves.every((m) => m.die === 6 && m.kind === 'leaveHome' && m.from === 0 && m.to === 1),
    ).toBe(true);

    const moved = applyMove(rolled, 'red-0', 6);
    expect(progressOf(moved, 'red-0')).toBe(1);
    expect(absoluteTrackIndex('red', 1)).toBe(START_INDEX.red);
  });

  it('passes the turn when a non-6 leaves every token stuck in the yard', () => {
    const game = createGame(['red', 'green'], [], findSeed([3]));
    const rolled = rollDice(game);

    expect(rolled.phase).toBe('awaiting-roll');
    expect(rolled.dice).toEqual([]);
    // The face still shows what came up, even though it could not be used.
    expect(rolled.lastRoll).toEqual([3]);
    expect(rolled.lastEvent).toEqual({ type: 'noLegalMove', color: 'red', values: [3] });
    expect(currentTurn(rolled).color).toBe('green');
  });

  it('opens onto a start square a friendly token is already standing on', () => {
    const game = awaitingMove(gameWith(['red', 'green'], { 'red-0': 1 }), 6);
    const movable = getLegalMoves(game).map((m) => m.tokenId);
    // The one already out can advance, and all three still in the yard can come
    // out onto the square it is holding.
    expect(movable).toEqual(['red-0', 'red-1', 'red-2', 'red-3']);
  });

  it('spends two sixes on two tokens, both landing on the start square', () => {
    const game = awaitingMove(gameWith(['red', 'green'], {}), [6, 6, 3]);

    const first = applyMove(game, 'red-0', 6);
    expect(progressOf(first, 'red-0')).toBe(1);
    expect(first.dice).toEqual([6, 3]);
    expect(first.phase).toBe('awaiting-move');

    // The spare six is still good for the yard: the first token out is not in
    // the doorway of the second.
    expect(getLegalMoves(first).some((m) => m.kind === 'leaveHome')).toBe(true);

    const second = applyMove(first, 'red-1', 6);
    expect(progressOf(second, 'red-1')).toBe(1);
    expect(progressOf(second, 'red-0')).toBe(1);
    expect(second.dice).toEqual([3]);
  });
});

describe('sixes', () => {
  it('holds a six and rolls again instead of playing it', () => {
    const game = createGame(['red', 'green'], [], findSeed([6, 3]));

    const first = rollDice(game);
    expect(first.phase).toBe('awaiting-roll');
    expect(first.dice).toEqual([6]);
    expect(first.consecutiveSixes).toBe(1);
    expect(currentTurn(first).color).toBe('red');

    const second = rollDice(first);
    expect(second.phase).toBe('awaiting-move');
    expect(second.dice).toEqual([6, 3]);
    expect(second.lastRoll).toEqual([6, 3]);
  });

  it('offers both held numbers on a token, and plays them in either order', () => {
    const game = awaitingMove(gameWith(['red', 'green'], { 'red-0': 5 }), [6, 3]);

    const forToken = getLegalMoves(game).filter((m) => m.tokenId === 'red-0');
    expect(forToken.map((m) => m.die).sort()).toEqual([3, 6]);

    // Spend the three first - the six is still in hand afterwards.
    const afterThree = applyMove(game, 'red-0', 3);
    expect(afterThree.dice).toEqual([6]);
    expect(afterThree.phase).toBe('awaiting-move');
    expect(progressOf(afterThree, 'red-0')).toBe(8);
    expect(currentTurn(afterThree).color).toBe('red');

    const afterSix = applyMove(afterThree, 'red-0', 6);
    expect(afterSix.dice).toEqual([]);
    expect(progressOf(afterSix, 'red-0')).toBe(14);
    expect(currentTurn(afterSix).color).toBe('green');
  });

  it('refuses to guess which number to spend when either would do', () => {
    const game = awaitingMove(gameWith(['red', 'green'], { 'red-0': 5 }), [6, 3]);
    expect(() => applyMove(game, 'red-0')).toThrow(/say which/);
  });

  it('holds a six even when it has no usable move, and rolls again', () => {
    // Every token home except one that would overshoot the center on a six.
    const stuck = gameWith(['red', 'green'], {
      'red-0': FINISH,
      'red-1': FINISH,
      'red-2': FINISH,
      'red-3': FINISH - 3,
    });
    const rolled = rollDice({ ...stuck, rngSeed: findSeed([6]) });

    expect(rolled.phase).toBe('awaiting-roll');
    expect(rolled.dice).toEqual([6]);
    expect(rolled.consecutiveSixes).toBe(1);
    expect(currentTurn(rolled).color).toBe('red');
  });

  it('forfeits the whole turn on a third consecutive six, held numbers and all', () => {
    const game = createGame(['red', 'green'], [], findSeed([6, 6, 6]));

    const second = rollDice(rollDice(game));
    expect(second.dice).toEqual([6, 6]);
    expect(second.consecutiveSixes).toBe(2);
    expect(second.phase).toBe('awaiting-roll');

    const third = rollDice(second);
    expect(third.lastEvent).toEqual({ type: 'threeSixes', color: 'red' });
    expect(third.phase).toBe('awaiting-roll');
    expect(third.dice).toEqual([]);
    expect(third.consecutiveSixes).toBe(0);
    expect(currentTurn(third).color).toBe('green');
    // Nothing held was ever played.
    expect(progressOf(third, 'red-0')).toBe(0);
  });

  it('resets the six counter once the turn passes', () => {
    const game = createGame(['red', 'green'], [], findSeed([6, 2]));
    const held = rollDice(rollDice(game));
    const afterSix = applyMove(held, 'red-0', 6);
    const afterTwo = applyMove(afterSix, 'red-0', 2);

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

    const after = applyMove(game, 'red-0', 5);
    expect(progressOf(after, 'red-0')).toBe(10);
    expect(progressOf(after, 'green-0')).toBe(0);
    expect(after.lastEvent).toEqual({ type: 'captured', by: 'red', tokenIds: ['green-0'] });
  });

  it('earns another roll for the capturing player', () => {
    const game = awaitingMove(gameWith(['red', 'green'], { 'red-0': 5, 'green-0': 49 }), 5);
    const after = applyMove(game, 'red-0', 5);

    // The hand is empty, yet the turn stays with red instead of passing.
    expect(after.dice).toEqual([]);
    expect(after.phase).toBe('awaiting-roll');
    expect(currentTurn(after).color).toBe('red');
    expect(after.bonusRolls).toBe(1);
    // A fresh sequence, so the six counter starts over.
    expect(after.consecutiveSixes).toBe(0);

    // Taking the roll spends the debt.
    const rolled = rollDice({ ...after, rngSeed: findSeed([2]) });
    expect(rolled.bonusRolls).toBe(0);
  });

  it('hands the dice straight back, with unspent numbers still in hand', () => {
    // Red captures with the 5 while a 2 is still to be spent.
    const game = awaitingMove(gameWith(['red', 'green'], { 'red-0': 5, 'green-0': 49 }), [5, 2]);
    const after = applyMove(game, 'red-0', 5);

    expect(after.bonusRolls).toBe(1);
    expect(after.phase).toBe('awaiting-roll');
    // The 2 is not washed away by the reward: it waits for the new number.
    expect(after.dice).toEqual([2]);
    expect(currentTurn(after).color).toBe('red');

    // Taking the roll adds to the hand rather than replacing it.
    const rolled = rollDice({ ...after, rngSeed: findSeed([4]) });
    expect(rolled.dice).toEqual([2, 4]);
    expect(rolled.lastRoll).toEqual([5, 2, 4]);
    expect(rolled.bonusRolls).toBe(0);
    expect(rolled.phase).toBe('awaiting-move');
    expect(currentTurn(rolled).color).toBe('red');
  });

  it('gives nothing for a move that captures nothing', () => {
    const game = awaitingMove(gameWith(['red', 'green'], { 'red-0': 5 }), 2);
    const after = applyMove(game, 'red-0', 2);

    expect(after.bonusRolls).toBe(0);
    expect(currentTurn(after).color).toBe('green');
  });

  it('forfeits an earned roll along with the rest of a third-six turn', () => {
    const captured = applyMove(
      awaitingMove(gameWith(['red', 'green'], { 'red-0': 5, 'green-0': 49 }), 5),
      'red-0',
      5,
    );
    expect(captured.bonusRolls).toBe(1);

    // Take the earned roll, and run it into three sixes.
    const third = rollDice(rollDice(rollDice({ ...captured, rngSeed: findSeed([6, 6, 6]) })));
    expect(third.lastEvent).toEqual({ type: 'threeSixes', color: 'red' });
    expect(third.bonusRolls).toBe(0);
    expect(currentTurn(third).color).toBe('green');
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

  it('sends home the lone tokens on the square but spares a colour standing two deep', () => {
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
    // Green's pair defends itself; yellow, standing alone, does not.
    expect(progressOf(after, 'green-0')).toBe(49);
    expect(progressOf(after, 'green-1')).toBe(49);
    expect(progressOf(after, 'yellow-0')).toBe(0);
  });

  it('counts the pile per colour, not per square', () => {
    // Two colours, one token each: neither is protected by the other's company.
    const game = awaitingMove(
      gameWith(['red', 'green', 'yellow'], {
        'red-0': 5,
        'green-0': 49,
        'yellow-0': 36,
      }),
      5,
    );
    const after = applyMove(game, 'red-0');
    expect(progressOf(after, 'green-0')).toBe(0);
    expect(progressOf(after, 'yellow-0')).toBe(0);
  });

  it('earns no extra roll when the pile it landed on was safe', () => {
    const game = awaitingMove(
      gameWith(['red', 'green'], { 'red-0': 5, 'green-0': 49, 'green-1': 49 }),
      5,
    );
    const move = getLegalMoves(game).find((m) => m.tokenId === 'red-0')!;
    expect(move.captures).toEqual([]);

    const after = applyMove(game, 'red-0', 5);
    expect(after.bonusRolls).toBe(0);
    expect(currentTurn(after).color).toBe('green');
  });
});

describe('own tokens stack', () => {
  it('lands on a square a friendly token is already holding', () => {
    const game = awaitingMove(
      gameWith(['red', 'green'], { 'red-0': 10, 'red-1': 5 }),
      5,
    );
    const movable = getLegalMoves(game).map((m) => m.tokenId);
    expect(movable).toContain('red-1');
    expect(movable).toContain('red-0');

    const after = applyMove(game, 'red-1', 5);
    expect(progressOf(after, 'red-1')).toBe(10);
    expect(progressOf(after, 'red-0')).toBe(10);
  });

  it('makes a pile of two safe from an opponent landing on it', () => {
    // Green's turn; its token reaches the square red is holding two deep.
    const game = awaitingMove(
      gameWith(
        ['red', 'green'],
        { 'red-0': 10, 'red-1': 10, 'green-0': 44 },
        { turnIndex: 1 },
      ),
      5,
    );
    const move = getLegalMoves(game).find((m) => m.tokenId === 'green-0')!;
    expect(move.to).toBe(49);
    expect(move.captures).toEqual([]);

    const after = applyMove(game, 'green-0', 5);
    expect(progressOf(after, 'red-0')).toBe(10);
    expect(progressOf(after, 'red-1')).toBe(10);
    // Nothing was taken, so nothing is owed.
    expect(after.bonusRolls).toBe(0);
  });

  it('leaves a pile capturable again once it thins back to one', () => {
    const game = awaitingMove(
      gameWith(
        ['red', 'green'],
        { 'red-0': 10, 'red-1': 20, 'green-0': 44 },
        { turnIndex: 1 },
      ),
      5,
    );
    const after = applyMove(game, 'green-0', 5);
    expect(progressOf(after, 'red-0')).toBe(0);
    expect(after.bonusRolls).toBe(1);
  });

  it('lets friendly tokens pile up on the center', () => {
    const game = awaitingMove(
      gameWith(['red', 'green'], { 'red-0': FINISH, 'red-1': FINISH - 3 }),
      3,
    );
    const move = getLegalMoves(game).find((m) => m.tokenId === 'red-1')!;
    expect(move.kind).toBe('finish');
    expect(move.to).toBe(FINISH);
  });
});

describe('exact count to finish', () => {
  it('accepts the exact roll into the center', () => {
    const game = awaitingMove(gameWith(['red', 'green'], { 'red-0': FINISH - 3 }), 3);
    const move = getLegalMoves(game).find((m) => m.tokenId === 'red-0')!;
    expect(move).toMatchObject({ from: FINISH - 3, to: FINISH, kind: 'finish' });
  });

  it('earns another roll for bringing a token home', () => {
    // Two tokens still out, so finishing one does not finish the player.
    const game = awaitingMove(
      gameWith(['red', 'green'], { 'red-0': FINISH - 3, 'red-1': 10 }),
      3,
    );
    const after = applyMove(game, 'red-0', 3);

    expect(progressOf(after, 'red-0')).toBe(FINISH);
    expect(after.bonusRolls).toBe(1);
    expect(after.phase).toBe('awaiting-roll');
    expect(currentTurn(after).color).toBe('red');
  });

  it('hands the dice back at once, keeping the numbers still in hand', () => {
    const game = awaitingMove(
      gameWith(['red', 'green'], { 'red-0': FINISH - 2, 'red-1': 10 }),
      [6, 2],
    );

    const finished = applyMove(game, 'red-0', 2);
    expect(finished.bonusRolls).toBe(1);
    expect(finished.phase).toBe('awaiting-roll');
    expect(finished.dice).toEqual([6]);
    expect(currentTurn(finished).color).toBe('red');

    const rolled = rollDice({ ...finished, rngSeed: findSeed([1]) });
    expect(rolled.dice).toEqual([6, 1]);
    expect(rolled.bonusRolls).toBe(0);
    expect(currentTurn(rolled).color).toBe('red');
  });

  it('keeps it whichever order the numbers are spent in', () => {
    const game = awaitingMove(
      gameWith(['red', 'green'], { 'red-0': FINISH - 2, 'red-1': 10 }),
      [6, 2],
    );
    // The six first this time, finishing second.
    const moved = applyMove(game, 'red-1', 6);
    expect(moved.bonusRolls).toBe(0);

    const finished = applyMove(moved, 'red-0', 2);
    expect(finished.bonusRolls).toBe(1);
    expect(currentTurn(finished).color).toBe('red');
  });

  it('gives no roll when the last token home ends the player', () => {
    const nearlyDone = gameWith(['red', 'green', 'yellow'], {
      'red-0': FINISH,
      'red-1': FINISH,
      'red-2': FINISH,
      'red-3': FINISH - 2,
    });
    const after = applyMove(awaitingMove(nearlyDone, 2), 'red-3', 2);

    // Red is finished; there is nothing left for an extra roll to move.
    expect(after.players[0].finished).toBe(true);
    expect(after.bonusRolls).toBe(0);
    expect(currentTurn(after).color).not.toBe('red');
  });

  it('refuses to move a token that would overshoot the center', () => {
    const game = awaitingMove(gameWith(['red', 'green'], { 'red-0': FINISH - 3 }), 4);
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
      'red-3': FINISH - 3,
    });
    const rolled = rollDice({ ...stuck, rngSeed: findSeed([5]) });

    expect(rolled.lastEvent).toEqual({ type: 'noLegalMove', color: 'red', values: [5] });
    expect(currentTurn(rolled).color).toBe('green');
    expect(progressOf(rolled, 'red-3')).toBe(FINISH - 3);
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

    const after = applyMove(withFinishedGreen, 'red-0', 3);
    expect(currentTurn(after).color).toBe('yellow');
  });

  it('refuses to roll while a move is pending, and to move before a roll', () => {
    const game = awaitingMove(gameWith(['red', 'green'], { 'red-0': 5 }), 3);
    expect(() => rollDice(game)).toThrow(/phase/);
    expect(() => applyMove({ ...game, phase: 'awaiting-roll' }, 'red-0', 3)).toThrow(/phase/);
    expect(() => applyMove(game, 'red-1', 3)).toThrow(/No legal move/);
  });
});

describe('the face on show', () => {
  it('records every roll, usable or not', () => {
    const game = createGame(['red', 'green'], [], findSeed([6, 3]));
    expect(game.lastRoll).toEqual([]);

    // Both rolls of the turn accumulate on the tray.
    const six = rollDice(game);
    expect(six.lastRoll).toEqual([6]);
    const both = rollDice(six);
    expect(both.lastRoll).toEqual([6, 3]);
    expect(both.dice).toEqual([6, 3]);

    // Spending a number takes it out of the hand but leaves the tray alone.
    const moved = applyMove(both, 'red-0', 6);
    expect(moved.dice).toEqual([3]);
    expect(moved.lastRoll).toEqual([6, 3]);
  });

  it('keeps the face through a forfeited third six', () => {
    const game = createGame(['red', 'green'], [], findSeed([6, 6, 6]));
    const third = rollDice(rollDice(rollDice(game)));

    expect(third.lastEvent).toEqual({ type: 'threeSixes', color: 'red' });
    expect(third.lastRoll).toEqual([6, 6, 6]);
  });
});

describe('skipping a turn', () => {
  it('hands the turn on without touching the board', () => {
    const game = gameWith(['red', 'green', 'yellow'], { 'red-0': 7, 'green-0': 3 });
    const after = skipTurn(game);

    expect(currentTurn(after).color).toBe('green');
    expect(after.phase).toBe('awaiting-roll');
    expect(after.dice).toEqual([]);
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
        'red-3': FINISH - 3,
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
        'red-3': FINISH - 6,
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
    const game = createGame(['red', 'green'], [], findSeed([6, 3]));
    const snapshot = JSON.parse(JSON.stringify(game));

    const rolled = rollDice(rollDice(game));
    applyMove(rolled, 'red-0', 6);

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
          state = applyMove(state, pick.tokenId, pick.die);
        }

        // Invariants that must hold after every single transition. Friendly
        // tokens are free to share a square now, so position is all there is
        // left to check.
        for (const player of state.players) {
          for (const token of player.tokens) {
            expect(token.progress).toBeGreaterThanOrEqual(0);
            expect(token.progress).toBeLessThanOrEqual(FINISH);
          }
        }
      }

      // A turn can now roll again on a capture or a finish, so a game takes
      // more transitions than it used to — but it must still terminate.
      expect(steps).toBeLessThan(20_000);
      expect(isGameOver(state)).toBe(true);
      expect(state.phase).toBe('game-over');
      expect(standings(state)).toHaveLength(4);
    }
  }, 30_000);
});
