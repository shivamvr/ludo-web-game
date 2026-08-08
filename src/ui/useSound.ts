import { useCallback, useEffect, useRef, useState } from 'react';

export type Cue = 'roll' | 'move' | 'capture' | 'home' | 'win' | 'skip';

/** Short tones, synthesised so the app ships no audio files. */
const CUES: Record<Cue, { notes: number[]; length: number; type: OscillatorType }> = {
  roll: { notes: [420, 560], length: 0.06, type: 'square' },
  move: { notes: [660], length: 0.05, type: 'triangle' },
  capture: { notes: [320, 200], length: 0.11, type: 'sawtooth' },
  home: { notes: [660, 880], length: 0.09, type: 'triangle' },
  win: { notes: [523, 659, 784, 1047], length: 0.13, type: 'triangle' },
  skip: { notes: [300, 240], length: 0.08, type: 'sine' },
};

const MUTE_KEY = 'ludo.muted';

export interface Sound {
  muted: boolean;
  toggleMuted: () => void;
  play: (cue: Cue) => void;
}

export function useSound(): Sound {
  const [muted, setMuted] = useState(() => localStorage.getItem(MUTE_KEY) === '1');
  const context = useRef<AudioContext | null>(null);

  useEffect(() => {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  }, [muted]);

  const play = useCallback(
    (cue: Cue) => {
      if (muted) return;
      try {
        // Created lazily: browsers only allow audio after a user gesture, and
        // every cue here follows a tap.
        context.current ??= new AudioContext();
        const audio = context.current;
        if (audio.state === 'suspended') void audio.resume();

        const { notes, length, type } = CUES[cue];
        notes.forEach((frequency, index) => {
          const start = audio.currentTime + index * length;
          const oscillator = audio.createOscillator();
          const gain = audio.createGain();
          oscillator.type = type;
          oscillator.frequency.setValueAtTime(frequency, start);
          // A quick fade out, so the tones do not click.
          gain.gain.setValueAtTime(0.06, start);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
          oscillator.connect(gain).connect(audio.destination);
          oscillator.start(start);
          oscillator.stop(start + length);
        });
      } catch {
        /* audio is a nicety; never let it break the game */
      }
    },
    [muted],
  );

  return { muted, toggleMuted: () => setMuted((m) => !m), play };
}
