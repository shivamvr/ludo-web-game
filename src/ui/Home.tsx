import { useState } from 'react';
import { DEFAULT_TOKEN_COUNT, DEFAULT_YARD_EXIT } from '../game/board';
import type { YardExit } from '../game/types';
import { createRoom, explain, inspectRoom, normalizeCode } from '../data/rooms';
import type { AuthState } from '../data/useAuth';
import RulePicker from './RulePicker';
import './Lobby.css';

interface Props {
  auth: AuthState;
  name: string;
  onNameChange: (name: string) => void;
  onEnterRoom: (roomId: string) => void;
  onPlayLocal: () => void;
}

/** Create a room, join one by code, or play locally on this device. */
export default function Home({ auth, name, onNameChange, onEnterRoom, onPlayLocal }: Props) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tokenCount, setTokenCount] = useState(DEFAULT_TOKEN_COUNT);
  const [yardExit, setYardExit] = useState<YardExit>(DEFAULT_YARD_EXIT);

  const online = auth.configured && auth.uid !== null;

  const create = async () => {
    if (!auth.uid) return;
    setBusy('create');
    setError(null);
    const result = await createRoom(auth.uid, name.trim() || 'Player', tokenCount, yardExit);
    setBusy(null);
    if (result.ok) onEnterRoom(result.value);
    else setError(explain(result));
  };

  /**
   * Check the room can be entered, then hand over to the room screen, which
   * takes the seat once its subscription is live. Deliberately the same path an
   * invite link follows — joining straight from here would run a transaction
   * against an empty local cache, which aborts before reaching the server.
   */
  const join = async () => {
    if (!auth.uid) return;
    const roomId = normalizeCode(code);
    if (roomId.length < 4) {
      setError('Enter the 4-character room code.');
      return;
    }
    setBusy('join');
    setError(null);
    const result = await inspectRoom(roomId, auth.uid);
    setBusy(null);
    if (result.ok) onEnterRoom(roomId);
    else setError(explain(result));
  };

  return (
    <main className="app app--setup">
      <div className="lobby">
        <h1 className="setup__title">Ludo</h1>
        <p className="setup__subtitle">Play with friends on their own phones.</p>

        {!auth.configured && (
          <div className="notice notice--warn">
            <strong>Online play is not configured.</strong>
            <p>
              Add a <code>.env</code> file with your Firebase settings, then restart{' '}
              <code>npm run dev</code>. Missing: {auth.missingKeys.join(', ')}
            </p>
          </div>
        )}
        {auth.error && <div className="notice notice--warn">{auth.error}</div>}

        {online && (
          <>
            <label className="field">
              <span className="field__label">Your name</span>
              <input
                className="field__input"
                value={name}
                maxLength={16}
                placeholder="Player"
                onChange={(e) => onNameChange(e.target.value)}
              />
            </label>

            {/* Only the creator picks: everyone who joins plays the host's game. */}
            <RulePicker
              tokenCount={tokenCount}
              onTokenCount={setTokenCount}
              yardExit={yardExit}
              onYardExit={setYardExit}
              disabled={busy !== null}
            />

            <button
              type="button"
              className="setup__start"
              onClick={create}
              disabled={busy !== null}
            >
              {busy === 'create' ? 'Creating…' : 'Create room'}
            </button>

            <div className="lobby__divider">or join with a code</div>

            <div className="lobby__join">
              <input
                className="field__input field__input--code"
                value={code}
                placeholder="ABCD"
                inputMode="text"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                maxLength={4}
                onChange={(e) => setCode(normalizeCode(e.target.value))}
              />
              <button
                type="button"
                className="lobby__join-button"
                onClick={join}
                disabled={busy !== null}
              >
                {busy === 'join' ? 'Joining…' : 'Join'}
              </button>
            </div>
          </>
        )}

        {auth.configured && !auth.uid && !auth.error && (
          <p className="lobby__pending">Signing in…</p>
        )}

        {error && <div className="notice notice--error">{error}</div>}

        <button type="button" className="link-button" onClick={onPlayLocal}>
          Play on this device instead
        </button>
      </div>
    </main>
  );
}
