import { useState } from 'react';
import {
  explain,
  rematchLineup,
  setRematchRules,
  startRematch,
  voteRematch,
  type Result,
} from '../data/rooms';
import type { Room } from '../data/serialize';
import type { YardExit } from '../game/types';
import { COLORS } from '../game/types';
import RulePicker from './RulePicker';
import './Rematch.css';

const EXIT_TEXT: Record<YardExit, string> = {
  six: 'out on a 6',
  'one-or-six': 'out on a 1 or a 6',
};

interface Props {
  room: Room;
  uid: string;
}

/**
 * The rematch offered once a game is over, shown on top of the result.
 *
 * The host settles the rules and starts it; everyone else answers. Nobody is
 * dealt into a game they have not agreed to, and nobody can hold the table
 * hostage either — the host may start as soon as one other player is in, and
 * whoever is not in simply stays and watches.
 */
export default function RematchPanel({ room, uid }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isHost = room.hostId === uid;
  const { tokenCount, yardExit, votes } = room.rematch;

  const lineup = new Set(rematchLineup(room.hostId, room.players, votes));
  const seats = Object.entries(room.players).sort(
    (a, b) => COLORS.indexOf(a[1].color) - COLORS.indexOf(b[1].color),
  );
  const hostName = room.players[room.hostId]?.name ?? 'the host';
  const myVote = votes[uid];

  const run = async (write: Promise<Result<void>>) => {
    setBusy(true);
    setError(null);
    const result = await write;
    setBusy(false);
    // The watchdog error for a write that changed nothing: a second tap on the
    // answer already given is not something to complain about.
    if (!result.ok && result.error !== 'nothing-to-do') setError(explain(result));
  };

  return (
    <div className="rematch">
      <p className="rematch__title">Play again?</p>

      <ul className="rematch__seats">
        {seats.map(([playerUid, player]) => (
          <li key={playerUid} className={`rematch__seat rematch__seat--${player.color}`}>
            <span className="rematch__dot" />
            <span className="rematch__name">
              {player.name}
              {playerUid === uid && ' (you)'}
            </span>
            <span className={`rematch__tag rematch__tag--${answer(playerUid)}`}>
              {ANSWER_TEXT[answer(playerUid)]}
            </span>
          </li>
        ))}
      </ul>

      {isHost ? (
        <>
          <RulePicker
            tokenCount={tokenCount}
            onTokenCount={(count) => void run(setRematchRules(room.id, uid, count, yardExit))}
            yardExit={yardExit}
            onYardExit={(exit) => void run(setRematchRules(room.id, uid, tokenCount, exit))}
            disabled={busy}
          />
          <button
            type="button"
            className="result__again"
            disabled={busy || lineup.size < 2}
            onClick={() => void run(startRematch(room.id, uid))}
          >
            {lineup.size >= 2 ? `Start rematch (${lineup.size})` : 'Waiting for someone to join in'}
          </button>
        </>
      ) : (
        <>
          <p className="rematch__rules">
            {tokenCount} tokens each · {EXIT_TEXT[yardExit]}
          </p>
          <div className="rematch__answer">
            <button
              type="button"
              className={`rematch__button${myVote === 'in' ? ' rematch__button--on' : ''}`}
              aria-pressed={myVote === 'in'}
              disabled={busy}
              onClick={() => void run(voteRematch(room.id, uid, 'in'))}
            >
              I'm in
            </button>
            <button
              type="button"
              className={`rematch__button${myVote === 'out' ? ' rematch__button--on' : ''}`}
              aria-pressed={myVote === 'out'}
              disabled={busy}
              onClick={() => void run(voteRematch(room.id, uid, 'out'))}
            >
              No thanks
            </button>
          </div>
          <p className="rematch__pending">
            {myVote === 'in'
              ? `Waiting for ${hostName} to start…`
              : `${hostName} sets the rules and starts the next game.`}
          </p>
        </>
      )}

      {error && <p className="rematch__error">{error}</p>}
    </div>
  );

  /** How a seat has answered, with the host counted in for starting it. */
  function answer(playerUid: string): Answer {
    if (lineup.has(playerUid)) return 'in';
    return votes[playerUid] === 'out' ? 'out' : 'asked';
  }
}

type Answer = 'in' | 'out' | 'asked';

const ANSWER_TEXT: Record<Answer, string> = {
  in: 'in',
  out: 'out',
  asked: '…',
};
