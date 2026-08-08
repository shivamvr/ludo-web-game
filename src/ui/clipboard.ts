/**
 * Copy text to the clipboard, reporting whether it worked.
 *
 * `navigator.clipboard` lives behind a secure context, so it is simply absent
 * when the app is opened over a plain LAN address — which is exactly how a phone
 * reaches a dev server, and the case where sharing an invite matters most. Even
 * where it exists it rejects while the document is unfocused.
 *
 * The old selection-based command has neither restriction, so it is the fallback
 * rather than the other way round.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied, or the document was not focused. Try the old way.
  }
  return selectionCopy(text);
}

function selectionCopy(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  // Kept in the layout but invisible: an element that is `display: none` cannot
  // be selected, and moving the page would be visible to the player.
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.left = '0';
  area.style.opacity = '0';
  area.style.pointerEvents = 'none';
  // Stops iOS zooming to a focused field with a small font.
  area.style.fontSize = '16px';
  area.setAttribute('readonly', '');
  document.body.appendChild(area);

  try {
    // iOS ignores select() on a readonly field; a range over its contents is
    // the form every browser honours.
    const range = document.createRange();
    range.selectNodeContents(area);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    area.setSelectionRange(0, text.length);

    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
