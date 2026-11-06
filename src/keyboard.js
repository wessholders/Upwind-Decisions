export const STEERING_DEGREES_PER_SECOND = 15;
export function steeringDelta(direction, elapsed) {
  return direction * STEERING_DEGREES_PER_SECOND * Math.min(0.1, Math.max(0, elapsed));
}
export function bindSailingKeyboard({ target = window, documentTarget = document, enabled, steer, tack, pause, menu }) {
  const held = new Set();
  const clear = () => held.clear();
  const formTarget = event => event.target?.closest?.('input, select, textarea, button, summary, a, [contenteditable], [role="slider"]');
  const editingTarget = event => event.target?.closest?.('input, select, textarea, [contenteditable], [role="slider"]');
  const down = event => {
    if (event.ctrlKey || event.altKey || event.metaKey || editingTarget(event) || !enabled()) return;
    // Reserve all arrow keys on the course, including the unused vertical
    // arrows, so game input never becomes browser scrolling. Editable fields
    // keep native navigation, and Space still activates buttons/summaries.
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyP', 'Escape'].includes(event.code)) return;
    if (event.code === 'Space') {
      const control = event.target?.closest?.('button, summary, a');
      if (control) {
        // Space has no native link action; its fallback would scroll the page.
        if (control.matches('a') || control.disabled) event.preventDefault();
        return;
      }
    }
    event.preventDefault();
    if (event.repeat || held.has(event.code)) return;
    held.add(event.code);
    if (event.code === 'Space') tack();
    if (event.code === 'KeyP') pause();
    if (event.code === 'Escape') menu();
  };
  const up = event => held.delete(event.code);
  const focus = event => { if (formTarget(event)) clear(); };
  const visibility = () => { if (documentTarget.hidden) clear(); };
  target.addEventListener('keydown', down); target.addEventListener('keyup', up);
  target.addEventListener('blur', clear); documentTarget.addEventListener('visibilitychange', visibility);
  target.addEventListener('focusin', focus);
  return { clear, tick(elapsed) {
    if (!enabled() || documentTarget.hidden) { clear(); return; }
    const delta = steeringDelta(Number(held.has('ArrowRight')) - Number(held.has('ArrowLeft')), elapsed);
    if (delta) steer(delta);
  }, destroy() {
    clear(); target.removeEventListener('keydown', down); target.removeEventListener('keyup', up);
    target.removeEventListener('blur', clear); documentTarget.removeEventListener('visibilitychange', visibility);
    target.removeEventListener('focusin', focus);
  } };
}
