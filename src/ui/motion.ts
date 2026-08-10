/**
 * Whether the player has asked for less movement. Checked at the moment an
 * animation would start rather than cached, so changing the system setting
 * takes effect without a reload.
 */
export function reducedMotion(): boolean {
  return (
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
