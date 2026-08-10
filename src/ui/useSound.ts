import { useCallback, useEffect, useRef, useState } from 'react';

export type Cue =
  | 'roll'
  | 'step'
  | 'move'
  | 'capture'
  | 'home'
  | 'win'
  | 'skip'
  | 'select';

const MUTE_KEY = 'ludo.muted';

/**
 * The shape of the dice cue, in milliseconds — `tumbles` knocks spaced `gap`
 * apart, then the die settles with a heavier one.
 *
 * Exported because the die's animation runs off the same numbers: the faces
 * change on the beat of the knocks and the real one lands on the settle, so
 * what is seen and what is heard are the same event rather than two that
 * happen to overlap.
 */
export const ROLL_TIMING = {
  tumbles: 5,
  gap: 55,
  settle: 310,
  /** How long the die keeps bouncing after it lands. */
  bounce: 120,
} as const;

/**
 * Everything a cue draws on. The output node is a compressor rather than the
 * destination directly, so overlapping voices duck each other instead of
 * clipping — a capture landing on the last tick of a walk is common.
 */
interface Kit {
  ctx: AudioContext;
  out: AudioNode;
  noise: AudioBuffer;
}

/** A pitched voice, optionally sliding from `freq` to `to`. */
function tone(
  kit: Kit,
  at: number,
  options: {
    freq: number;
    to?: number;
    type?: OscillatorType;
    dur: number;
    gain?: number;
  },
) {
  const { freq, to, type = 'sine', dur, gain = 0.07 } = options;
  const osc = kit.ctx.createOscillator();
  const amp = kit.ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), at + dur);
  // A brief attack instead of a hard start, which would click; the tail decays
  // exponentially so a note dies away like something struck.
  amp.gain.setValueAtTime(0.0001, at);
  amp.gain.exponentialRampToValueAtTime(gain, at + Math.min(0.008, dur / 4));
  amp.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(amp).connect(kit.out);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

/** A burst of filtered noise: dice on wood, the thud of a capture. */
function hiss(
  kit: Kit,
  at: number,
  options: {
    dur: number;
    gain?: number;
    freq: number;
    to?: number;
    q?: number;
    type?: BiquadFilterType;
  },
) {
  const { dur, gain = 0.05, freq, to, q = 1, type = 'bandpass' } = options;
  const src = kit.ctx.createBufferSource();
  src.buffer = kit.noise;
  const filter = kit.ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, at);
  if (to !== undefined) filter.frequency.exponentialRampToValueAtTime(Math.max(to, 20), at + dur);
  filter.Q.value = q;
  const amp = kit.ctx.createGain();
  amp.gain.setValueAtTime(gain, at);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(filter).connect(amp).connect(kit.out);
  // A different slice of noise each time, so repeated knocks are not identical.
  src.start(at, Math.random() * 0.4);
  src.stop(at + dur + 0.02);
}

/**
 * One function per cue, written against the kit above. Nothing here loads a
 * file: the whole soundtrack is synthesised, so the app ships no audio assets
 * and a cue costs nothing to add.
 */
const VOICES: Record<Cue, (kit: Kit, at: number) => void> = {
  // Dice tumbling across the board, then settling with a knock that has some
  // body to it. The scatter is randomised so no two rolls sound alike.
  roll: (kit, at) => {
    for (let i = 0; i < ROLL_TIMING.tumbles; i++) {
      // The jitter is small enough that a knock still reads as landing on the
      // beat the die is animating to, and large enough to break the machine-gun
      // regularity of an exactly even spacing.
      hiss(kit, at + (i * ROLL_TIMING.gap) / 1000 + Math.random() * 0.018, {
        dur: 0.035,
        gain: 0.05 - i * 0.006,
        freq: 1700 + Math.random() * 1000,
        q: 1.4,
      });
    }
    const settle = at + ROLL_TIMING.settle / 1000;
    hiss(kit, settle, { dur: 0.08, gain: 0.07, freq: 900, to: 260, q: 0.8 });
    tone(kit, settle, { freq: 190, to: 118, type: 'triangle', dur: 0.11, gain: 0.05 });
  },

  // One square of a walk. Deliberately faint and short: it fires once per
  // square crossed, so anything fuller would turn a six into a drum roll.
  step: (kit, at) => {
    hiss(kit, at, { dur: 0.012, gain: 0.02, freq: 2600, q: 0.7, type: 'highpass' });
    tone(kit, at, { freq: 900, type: 'sine', dur: 0.028, gain: 0.022 });
  },

  // Landing at the end of a walk — the counterpart to the ticks above.
  move: (kit, at) => {
    tone(kit, at, { freq: 300, to: 155, type: 'triangle', dur: 0.11, gain: 0.055 });
    hiss(kit, at, { dur: 0.03, gain: 0.025, freq: 700, to: 300, q: 0.9 });
  },

  // A hit: a low thump under a sawtooth dropping out of the audible range.
  capture: (kit, at) => {
    hiss(kit, at, { dur: 0.09, gain: 0.09, freq: 1400, to: 200, q: 0.6, type: 'lowpass' });
    tone(kit, at, { freq: 420, to: 70, type: 'sawtooth', dur: 0.22, gain: 0.07 });
    tone(kit, at + 0.02, { freq: 208, to: 62, type: 'square', dur: 0.18, gain: 0.03 });
  },

  // A token reaching the centre: three rising notes, brightening as they go.
  home: (kit, at) => {
    [660, 880, 1320].forEach((freq, i) => {
      tone(kit, at + i * 0.075, { freq, type: 'triangle', dur: 0.16, gain: 0.055 });
    });
  },

  // The fanfare finishes on a held chord rather than simply stopping.
  win: (kit, at) => {
    [523, 659, 784, 1047].forEach((freq, i) => {
      tone(kit, at + i * 0.11, { freq, type: 'triangle', dur: 0.2, gain: 0.055 });
    });
    [523, 659, 784].forEach((freq) => {
      tone(kit, at + 0.44, { freq, type: 'triangle', dur: 0.7, gain: 0.03 });
    });
  },

  // Nothing to play, or a turn thrown away: a flat drop, no sparkle.
  skip: (kit, at) => {
    tone(kit, at, { freq: 330, to: 150, type: 'sine', dur: 0.24, gain: 0.055 });
    tone(kit, at + 0.01, { freq: 165, to: 78, type: 'square', dur: 0.22, gain: 0.018 });
  },

  // Picking which number to spend. A tap, not an event.
  select: (kit, at) => {
    tone(kit, at, { freq: 1250, type: 'sine', dur: 0.035, gain: 0.035 });
  },
};

/** A second of white noise, shared by every burst on a given context. */
function makeNoise(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

export interface Sound {
  muted: boolean;
  toggleMuted: () => void;
  /** Stable across renders, so effects can depend on it without re-firing. */
  play: (cue: Cue) => void;
}

export function useSound(): Sound {
  const [muted, setMuted] = useState(() => localStorage.getItem(MUTE_KEY) === '1');
  const kit = useRef<Kit | null>(null);
  // Read through a ref so `play` never has to be rebuilt, which would restart
  // every effect that depends on it — including the one driving the walk ticks.
  const silent = useRef(muted);

  useEffect(() => {
    silent.current = muted;
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  }, [muted]);

  const play = useCallback((cue: Cue) => {
    if (silent.current) return;
    try {
      if (!kit.current) {
        // Built lazily: browsers only allow audio after a user gesture, and
        // every cue here follows a tap.
        const ctx = new AudioContext();
        const out = ctx.createDynamicsCompressor();
        out.threshold.value = -18;
        out.ratio.value = 6;
        out.connect(ctx.destination);
        kit.current = { ctx, out, noise: makeNoise(ctx) };
      }
      const current = kit.current;
      if (current.ctx.state === 'suspended') void current.ctx.resume();
      // A hair in the future: scheduling exactly at currentTime can drop the
      // attack on a busy main thread.
      VOICES[cue](current, current.ctx.currentTime + 0.008);
    } catch {
      /* audio is a nicety; never let it break the game */
    }
  }, []);

  const toggleMuted = useCallback(() => setMuted((m) => !m), []);

  return { muted, toggleMuted, play };
}
