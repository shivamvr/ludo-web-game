import { useMemo, useState } from 'react';
import { applyMove, createGame, getLegalMoves, rollDice } from '../game/engine';
import type { Color, GameState } from '../game/types';
import GameView from './GameView';
import Setup from './Setup';
import './LocalGame.css';

/**
 * Pass-and-play on one device: the GameState lives in React state and the pure
 * engine drives it. The online game is the same thing with Firebase in place of
 * useState.
 */
export default function LocalGame({ onExit }: { onExit: () => void }) {
  const [state, setState] = useState<GameState | null>(null);

  const legalMoves = useMemo(() => (state ? getLegalMoves(state) : []), [state]);

  if (!state) {
    return (
      <main className="app app--setup">
        <Setup
          onStart={(colors: Color[], tokenCount: number) =>
            setState(createGame(colors, [], undefined, tokenCount))
          }
          onBack={onExit}
        />
      </main>
    );
  }

  // Both handlers transition from the state of *this* render rather than from a
  // setState updater. Two taps landing before React re-renders then compute the
  // same result instead of applying two transitions in a row.
  const roll = () => {
    if (state.phase !== 'awaiting-roll') return;
    setState(rollDice(state));
  };

  const move = (tokenId: string, die: number) => {
    if (state.phase !== 'awaiting-move') return;
    if (!legalMoves.some((m) => m.tokenId === tokenId && m.die === die)) return;
    setState(applyMove(state, tokenId, die));
  };

  return (
    <GameView
      state={state}
      legalMoves={legalMoves}
      canRoll={state.phase === 'awaiting-roll'}
      onRoll={roll}
      onTokenClick={move}
      headerAction={{ label: 'New game', onClick: () => setState(null) }}
      resultAction={{ label: 'Play again', onClick: () => setState(null) }}
    />
  );
}
