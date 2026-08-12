import { useState } from 'react';
import dieFive from '../assets/dice-5.svg';
import dieSix from '../assets/dice-6.svg';
import logo from '../assets/logo.webp';
import { DEFAULT_TOKEN_COUNT, DEFAULT_YARD_EXIT } from '../game/board';
import type { YardExit } from '../game/types';
import { createRoom, explain, inspectRoom, normalizeCode } from '../data/rooms';
import type { AuthState } from '../data/useAuth';
import OptionRow from './OptionRow';
import { COUNT_CHOICES, EXIT_CHOICES } from './RulePicker';
import './Home.css';

interface Props {
  auth: AuthState;
  name: string;
  /** The room this device was last in, offered back rather than retyped. */
  lastRoom: string | null;
  onNameChange: (name: string) => void;
  onEnterRoom: (roomId: string) => void;
  onForgetRoom: () => void;
  onPlayLocal: () => void;
}

/** Create a room, join one by code, or play locally on this device. */
export default function Home({
  auth,
  name,
  lastRoom,
  onNameChange,
  onEnterRoom,
  onForgetRoom,
  onPlayLocal,
}: Props) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | 'rejoin' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tokenCount, setTokenCount] = useState(DEFAULT_TOKEN_COUNT);
  const [yardExit, setYardExit] = useState<YardExit>(DEFAULT_YARD_EXIT);

  const online = auth.configured && auth.uid !== null;
  const working = busy !== null;

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
   * Back to the room this device was last in, keeping the code everyone
   * already has. Your seat is still there — a room only turns you away while a
   * game is actually being played — so this is a tap rather than a code to
   * type and share round again.
   */
  const rejoin = async () => {
    if (!auth.uid || !lastRoom) return;
    setBusy('rejoin');
    setError(null);
    const result = await inspectRoom(lastRoom, auth.uid);
    setBusy(null);
    if (result.ok) {
      onEnterRoom(lastRoom);
      return;
    }
    // Gone, or moved on without us. Stop offering a button that cannot work.
    onForgetRoom();
    setError(explain(result));
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
    <main className="home">
      {/* Two boards lying out of focus and a pair of dice, none of it
          interactive — the screen's backdrop, not its furniture. */}
      <div className="home__scene" aria-hidden="true">
        <div className="home__board home__board--left" />
        <div className="home__board home__board--right" />
        <div className="home__veil" />
        <img className="home__die home__die--left" src={dieSix} alt="" />
        <img className="home__die home__die--right" src={dieSix} alt="" />
      </div>

      <div className="home__inner">
        <div className="home__mark">
          <h1 className="home__title">
            <img className="home__logo" src={logo} alt="Ludo" />
          </h1>
          <span className="home__sparkle home__sparkle--left" aria-hidden="true">
            ✦
          </span>
          <span className="home__sparkle home__sparkle--right" aria-hidden="true">
            ✦
          </span>
          <p className="home__ribbon">Play with friends on their own phones</p>
        </div>

        <div className="home__card">
          {!auth.configured && (
            <div className="home__notice home__notice--warn">
              <strong>Online play is not configured.</strong>
              <p>
                Add a <code>.env</code> file with your Firebase settings, then restart{' '}
                <code>npm run dev</code>. Missing: {auth.missingKeys.join(', ')}
              </p>
            </div>
          )}
          {auth.error && <div className="home__notice home__notice--warn">{auth.error}</div>}

          {online && lastRoom && (
            <>
              <button
                type="button"
                className="home-button home-button--rejoin"
                onClick={rejoin}
                disabled={working}
              >
                {busy === 'rejoin' ? 'Rejoining…' : `Rejoin room ${lastRoom}`}
              </button>
              {/* Only stops this room being offered — the seat itself stays, so
                  the code still works if it is wanted back later. */}
              <button
                type="button"
                className="home__quiet home__quiet--link"
                onClick={onForgetRoom}
              >
                Forget this room
              </button>
              <div className="home__divider">or start a new game</div>
            </>
          )}

          {online && (
            <>
              <div className="home-field">
                <span className="home-field__badge home-field__badge--name" aria-hidden="true">
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="#fff">
                    <circle cx="12" cy="8" r="4" />
                    <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z" />
                  </svg>
                </span>
                <label className="home-field__body">
                  <span className="home-field__label">Your name</span>
                  <span className="home-field__input">
                    <input
                      value={name}
                      maxLength={16}
                      placeholder="Player"
                      onChange={(e) => onNameChange(e.target.value)}
                    />
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#bdb2e8"
                      strokeWidth="2"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <path d="M4 20h4L20 8l-4-4L4 16z" />
                    </svg>
                  </span>
                </label>
              </div>

              {/* Only the creator picks: everyone who joins plays the host's game. */}
              <div className="home-field">
                <span className="home-field__badge home-field__badge--tokens" aria-hidden="true">
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="#fff">
                    <circle cx="12" cy="7" r="3.4" />
                    <path d="M5 21c0-4 3.2-6.6 7-6.6S19 17 19 21z" />
                  </svg>
                </span>
                <div className="home-field__body home-choices home-choices--tokens">
                  <OptionRow
                    label="Tokens each"
                    choices={COUNT_CHOICES}
                    value={tokenCount}
                    onChange={setTokenCount}
                    disabled={working}
                  />
                </div>
              </div>

              <div className="home-field">
                <span className="home-field__badge home-field__badge--yard" aria-hidden="true">
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="#fff">
                    <path d="M12 3 2.6 11h2.8v9h5.2v-5.6h2.8V20h5.2v-9h2.8z" />
                  </svg>
                </span>
                <div className="home-field__body home-choices home-choices--yard">
                  <OptionRow
                    label="Leave the yard on"
                    choices={EXIT_CHOICES}
                    value={yardExit}
                    onChange={setYardExit}
                    disabled={working}
                  />
                </div>
              </div>

              <div className="home__create">
                <button
                  type="button"
                  className="home-button home-button--create"
                  onClick={create}
                  disabled={working}
                >
                  <img src={dieFive} alt="" />
                  {busy === 'create' ? 'Creating…' : 'Create Room'}
                </button>
                <span className="home__sparkle" aria-hidden="true">
                  ✦
                </span>
              </div>

              <div className="home__divider">or join with a code</div>

              <div className="home__join">
                <div className="home__code">
                  <span className="home__shield" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="#dce8ff">
                      <path d="M12 2 4 5v7c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10V5z" />
                    </svg>
                  </span>
                  <input
                    value={code}
                    placeholder="ABCD"
                    aria-label="Room code"
                    inputMode="text"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={4}
                    onChange={(e) => setCode(normalizeCode(e.target.value))}
                    onKeyDown={(e) => e.key === 'Enter' && void join()}
                  />
                </div>
                <button
                  type="button"
                  className="home__join-button"
                  onClick={join}
                  disabled={working}
                >
                  {busy === 'join' ? '…' : 'Join'}
                </button>
              </div>
            </>
          )}

          {auth.configured && !auth.uid && !auth.error && (
            <p className="home__quiet">Signing in…</p>
          )}

          {error && <div className="home__notice home__notice--error">{error}</div>}

          <button type="button" className="home__link" onClick={onPlayLocal}>
            <span className="home__phone" aria-hidden="true" />
            <span>Play on this device instead</span>
          </button>
        </div>
      </div>
    </main>
  );
}
