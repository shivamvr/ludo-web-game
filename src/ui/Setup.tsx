import { useState } from 'react';
import dieFive from '../assets/dice-5.svg';
import dieSix from '../assets/dice-6.svg';
import logo from '../assets/logo.webp';
import tokenBlue from '../assets/token-blue-top.svg';
import tokenGreen from '../assets/token-green-top.svg';
import tokenRed from '../assets/token-red-top.svg';
import tokenYellow from '../assets/token-yellow-top.svg';
import { DEFAULT_TOKEN_COUNT, DEFAULT_YARD_EXIT } from '../game/board';
import type { Color, YardExit } from '../game/types';
import { COLORS } from '../game/types';
import OptionRow from './OptionRow';
import { COUNT_CHOICES, EXIT_CHOICES } from './RulePicker';
import './ui.css';
import './Home.css';
import './Setup.css';

/** The board's own pieces, standing in for the colours you can pick. */
const TOKEN_ART: Record<Color, string> = {
  red: tokenRed,
  green: tokenGreen,
  yellow: tokenYellow,
  blue: tokenBlue,
};

interface Props {
  onStart: (colors: Color[], tokenCount: number, yardExit: YardExit) => void;
  onBack: () => void;
}

/**
 * Setting up a game to pass round one device: which colours are playing, and
 * the same two rules the host settles online.
 *
 * Dressed as the lobby it is reached from, down to the stylesheet — the shell
 * (backdrop, wordmark, card, fields, buttons) is Home.css, so the two screens
 * cannot drift apart. Only what is peculiar to this one lives in Setup.css.
 */
export default function Setup({ onStart, onBack }: Props) {
  const [selected, setSelected] = useState<Color[]>(['red', 'green', 'yellow', 'blue']);
  const [tokenCount, setTokenCount] = useState(DEFAULT_TOKEN_COUNT);
  const [yardExit, setYardExit] = useState<YardExit>(DEFAULT_YARD_EXIT);

  const toggle = (color: Color) => {
    setSelected((prev) =>
      prev.includes(color) ? prev.filter((c) => c !== color) : [...prev, color],
    );
  };

  const ready = selected.length >= 2;

  return (
    <main className="home home--setup">
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
          <p className="home__ribbon">Pass and play on one device</p>
        </div>

        <div className="home__card">
          <div className="home-field">
            <span className="home-field__badge home-field__badge--name" aria-hidden="true">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="#fff">
                <circle cx="8.5" cy="8" r="3.6" />
                <circle cx="17" cy="9" r="2.8" />
                <path d="M1.5 20c0-3.8 3.1-6.2 7-6.2s7 2.4 7 6.2z" />
                <path d="M16.4 13.6c3.2 0 6.1 1.9 6.1 5.2v1.2h-5.1v-1.6c0-1.8-.7-3.4-1.9-4.6z" />
              </svg>
            </span>
            <div className="home-field__body">
              <span className="home-field__label">Who is playing</span>
              <div className="setup-seats" role="group" aria-label="Colours in play">
                {COLORS.map((color) => {
                  const on = selected.includes(color);
                  return (
                    <button
                      key={color}
                      type="button"
                      className={`setup-seat setup-seat--${color}${on ? ' setup-seat--on' : ''}`}
                      onClick={() => toggle(color)}
                      aria-pressed={on}
                    >
                      <img className="setup-seat__token" src={TOKEN_ART[color]} alt="" />
                      {color}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

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
              />
            </div>
          </div>

          <div className="home__create">
            <button
              type="button"
              className="home-button home-button--create setup-start"
              onClick={() => onStart(selected, tokenCount, yardExit)}
              disabled={!ready}
            >
              <img src={dieFive} alt="" />
              {ready ? `Start ${selected.length}-Player Game` : 'Pick At Least 2 Colours'}
            </button>
            <span className="home__sparkle" aria-hidden="true">
              ✦
            </span>
          </div>

          <button type="button" className="ui-back" onClick={onBack}>
            <svg
              width="22"
              height="16"
              viewBox="0 0 30 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M28 10H3" />
              <path d="M10 3 3 10l7 7" />
            </svg>
            Back
          </button>
        </div>
      </div>
    </main>
  );
}
