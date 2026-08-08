import { describe, expect, it } from 'vitest';
import { applyMove, createGame, getLegalMoves, isGameOver, rollDice } from '../../game/engine';
import type { GameState } from '../../game/types';
import { forDatabase, toGameState, toRoom } from '../serialize';
import { simulateRtdb } from './rtdb';

const roundTrip = (state: GameState) => toGameState(simulateRtdb(forDatabase(state)));

describe('GameState round-trip through Realtime Database', () => {
  it('survives a fresh game, holes and all', () => {
    const game = createGame(['red', 'green'], ['Ana', 'Bo'], 99);
    // These are exactly the fields RTDB would silently drop.
    expect(game.dice).toBeNull();
    expect(game.lastEvent).toBeNull();
    expect(game.winnerOrder).toEqual([]);

    expect(roundTrip(game)).toEqual(game);
  });

  it('preserves uid and connected on seated players', () => {
    const base = createGame(['red', 'green'], ['Ana', 'Bo'], 7);
    const seated: GameState = {
      ...base,
      players: base.players.map((p, i) => ({ ...p, uid: `uid-${i}`, connected: true })),
    };
    expect(roundTrip(seated)).toEqual(seated);
  });

  it('survives every state of several full games', () => {
    for (let seed = 1; seed <= 6; seed++) {
      let state = createGame(['red', 'green', 'yellow', 'blue'], [], seed * 104729);
      let steps = 0;

      while (!isGameOver(state) && steps < 20_000) {
        steps++;
        state =
          state.phase === 'awaiting-roll'
            ? rollDice(state)
            : applyMove(state, getLegalMoves(state)[0].tokenId);

        const restored = roundTrip(state);
        expect(restored).toEqual(state);
      }
      expect(isGameOver(state)).toBe(true);
    }
  });

  it('keeps an empty capture list an empty list', () => {
    const game = createGame(['red', 'green'], [], 5);
    const moved: GameState = {
      ...game,
      lastEvent: {
        type: 'moved',
        color: 'red',
        move: { tokenId: 'red-0', from: 1, to: 4, kind: 'advance', captures: [] },
      },
    };
    const restored = roundTrip(moved)!;
    expect(restored.lastEvent).toEqual(moved.lastEvent);
  });

  it('rejects snapshots that are not a usable game', () => {
    expect(toGameState(null)).toBeNull();
    expect(toGameState({})).toBeNull();
    expect(toGameState({ players: [{ color: 'red' }] })).toBeNull();
  });
});

describe('Room round-trip', () => {
  it('rebuilds a waiting room', () => {
    const raw = {
      hostId: 'uid-a',
      status: 'waiting',
      players: {
        'uid-a': { name: 'Ana', color: 'red', joinedAt: 10 },
        'uid-b': { name: 'Bo', color: 'green', joinedAt: 20 },
      },
      createdAt: 5,
    };
    const room = toRoom('ABCD', simulateRtdb(raw))!;

    expect(room.id).toBe('ABCD');
    expect(room.status).toBe('waiting');
    expect(room.gameState).toBeNull();
    expect(Object.keys(room.players)).toEqual(['uid-a', 'uid-b']);
    expect(room.players['uid-a'].connected).toBe(true);
  });

  it('carries the game state once play begins', () => {
    const game = createGame(['red', 'green'], ['Ana', 'Bo'], 3);
    const raw = {
      hostId: 'uid-a',
      status: 'playing',
      players: { 'uid-a': { name: 'Ana', color: 'red', joinedAt: 10 } },
      gameState: forDatabase(game),
      createdAt: 5,
    };
    const room = toRoom('ABCD', simulateRtdb(raw))!;

    expect(room.status).toBe('playing');
    expect(room.gameState).toEqual(game);
  });

  it('returns null for a room that does not exist', () => {
    expect(toRoom('ZZZZ', null)).toBeNull();
  });
});
