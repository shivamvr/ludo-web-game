import './ui.css';

/**
 * The wordmark, in the small size a bar takes: the same four letters as the
 * home screen, with the crown over the U.
 */
export default function Mark() {
  return (
    <div className="ui-mark">
      <span className="ui-crown" aria-hidden="true">
        <span className="ui-crown-points" />
        <span className="ui-crown-band" />
      </span>
      <span>L</span>
      <span>U</span>
      <span>D</span>
      <span>O</span>
    </div>
  );
}

/** The arrow every "back" wears. */
export function BackArrow() {
  return (
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
  );
}

/** The speaker on the mute button, crossed out when it is off. */
export function SoundIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9z" />
      <path
        d={muted ? 'M16 9l5 6M21 9l-5 6' : 'M16.5 8.5a5 5 0 0 1 0 7'}
        stroke="currentColor"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The door on the Leave button. */
export function LeaveIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 4h5v16h-5" />
      <path d="M9 8l4 4-4 4" />
      <path d="M13 12H3" />
    </svg>
  );
}
