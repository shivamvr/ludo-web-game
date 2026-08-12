import { TOKEN_COUNTS, YARD_EXITS } from '../game/board';
import type { YardExit } from '../game/types';
import OptionRow from './OptionRow';

const COUNTS = TOKEN_COUNTS.map((count) => ({ value: count, label: String(count) }));

const EXIT_LABELS: Record<YardExit, string> = {
  six: 'Only a 6',
  'one-or-six': 'A 1 or a 6',
};
const EXITS = YARD_EXITS.map((exit) => ({ value: exit, label: EXIT_LABELS[exit] }));

interface Props {
  tokenCount: number;
  onTokenCount: (count: number) => void;
  yardExit: YardExit;
  onYardExit: (exit: YardExit) => void;
  disabled?: boolean;
}

/**
 * The rules the host settles before anyone rolls. Shared by the online lobby
 * and the pass-and-play setup so the two offer exactly the same choices.
 */
export default function RulePicker({
  tokenCount,
  onTokenCount,
  yardExit,
  onYardExit,
  disabled,
}: Props) {
  return (
    <>
      <OptionRow
        label="Tokens each"
        choices={COUNTS}
        value={tokenCount}
        onChange={onTokenCount}
        disabled={disabled}
      />
      <OptionRow
        label="Leave the yard on"
        choices={EXITS}
        value={yardExit}
        onChange={onYardExit}
        disabled={disabled}
      />
    </>
  );
}
