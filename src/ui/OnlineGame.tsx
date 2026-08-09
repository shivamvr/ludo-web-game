import { useEffect, useMemo, useState } from 'react';
import {
  abandonIfDeserted,
  commitTurn,
  currentSeatUid,
  explain,
  isPresent,
  presentUids,
  skipAbsentTurn,
} from '../data/rooms';
import type { Room } from '../data/serialize';
import type { Presence } from '../data/usePresence';
import { applyMove, getLegalMoves, rollDice } from '../game/engine';
import type { GameState } from '../game/types';
import GameView from './GameView';
import './Lobby.css';

/** How often each client checks whether the table is stuck on an absent player. */
const WATCHDOG_MS = 4000;

interface Props {
  room: Room;
  state: GameState;
  uid: string;
  presence: Presence;
  onLeave: () => void;
}

/**
 * The synced game. Nothing is kept in local state: the board renders whatever
 * the room snapshot says. When it is this client's turn, the pure engine
 * computes the next state and it is written back to the room.
 */
export default function OnlineGame({ room, state, uid, presence, onLeave }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mySeat = state.players.find((p) => p.uid === uid) ?? null;
  const abandoned = room.endedReason === 'abandoned';
  const live = room.status === 'playing' && state.phase !== 'game-over' && !abandoned;
  const myTurn = live && currentSeatUid(state) === uid && presence.online;

  const ownerUid = currentSeatUid(state);
  const waitingOnAbsent = live && ownerUid !== undefined && !isPresent(room.players[ownerUid]);
  const absentNames = Object.entries(room.players)
    .filter(([, player]) => !isPresent(player))
    .map(([, player]) => player.name);
  // With fewer than two players here the turn cannot usefully be passed on, so
  // the table waits to be called off instead of playing through.
  const canPlayOn = presentUids(room.players).length >= 2;

  // Only the player to move sees highlights, so nobody can tap another seat's tokens.
  const legalMoves = useMemo(() => (myTurn ? getLegalMoves(state) : []), [myTurn, state]);

  /**
   * Every connected client polls for a table stuck on someone who left. The
   * writes are idempotent transactions, so clients racing each other is
   * harmless — the first one through moves the turn on and the rest abort.
   */
  const seated = mySeat !== null;
  useEffect(() => {
    if (!live || !seated || !presence.online) return;

    const tick = () => {
      const now = presence.serverNow();
      void skipAbsentTurn(room.id, uid, now);
      void abandonIfDeserted(room.id, uid, now);
    };
    const timer = setInterval(tick, WATCHDOG_MS);
    return () => clearInterval(timer);
  }, [live, seated, presence, room.id, uid]);

  const commit = async (advance: (s: GameState) => GameState) => {
    if (!myTurn || busy) return;
    setBusy(true);
    setError(null);
    const result = await commitTurn(room.id, uid, advance);
    setBusy(false);
    if (!result.ok) setError(explain(result));
  };

  const roll = () => {
    if (state.phase !== 'awaiting-roll') return;
    void commit(rollDice);
  };

  const move = (tokenId: string, die: number) => {
    if (state.phase !== 'awaiting-move') return;
    if (!legalMoves.some((m) => m.tokenId === tokenId && m.die === die)) return;
    // The die travels into the transaction: it re-runs against fresh server
    // data, where the same token may well be movable by either number.
    void commit((s) => applyMove(s, tokenId, die));
  };

  const turnName = state.players[state.turnIndex]?.name ?? 'Someone';

  return (
    <GameView
      state={state}
      legalMoves={legalMoves}
      canRoll={myTurn && state.phase === 'awaiting-roll' && !busy}
      onRoll={roll}
      onTokenClick={move}
      rollLabel={rollLabel()}
      ended={
        abandoned
          ? { title: 'Game abandoned', subtitle: 'Everyone else left the table.' }
          : undefined
      }
      banner={
        <div className={`banner${myTurn ? ' banner--active' : ''}`}>
          <span className="banner__room">Room {room.id}</span>
          <span className="banner__turn">{turnText()}</span>
          {mySeat && (
            <span className={`banner__you banner__you--${mySeat.color}`}>
              <span className="banner__dot" />
              {mySeat.color}
            </span>
          )}
          {presence.online && absentNames.length > 0 && (
            <span className="banner__away">
              Away: {absentNames.join(', ')}
              {canPlayOn
                ? waitingOnAbsent && ' — playing on shortly'
                : ' — the game ends if nobody comes back'}
            </span>
          )}
          {error && <span className="banner__error">{error}</span>}
        </div>
      }
      headerAction={{ label: 'Leave', onClick: onLeave }}
      resultAction={{ label: 'Back to lobby', onClick: onLeave }}
    />
  );

  function turnText(): string {
    if (!seated) return 'Watching';
    if (!presence.online) return 'Reconnecting…';
    if (abandoned) return 'Abandoned';
    if (state.phase === 'game-over') return 'Game over';
    if (myTurn) return 'Your turn';
    if (waitingOnAbsent) return `Waiting for ${turnName}`;
    return `${turnName}'s turn`;
  }

  function rollLabel(): string | undefined {
    if (abandoned) return 'Ended';
    if (state.phase === 'game-over') return 'Finished';
    if (!presence.online) return 'Offline';
    return myTurn ? undefined : 'Waiting…';
  }
}
