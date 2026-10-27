import { gateAimGeometry } from '../engine/physics.js';

export function bearControlView({ boat, scenario, phase, inspection = null }) {
  const pressed = boat.mode === 'gate';
  const label = pressed ? 'Return close-hauled' : 'Bear away to mark';
  if (inspection) return { disabled: true, pressed, label, state: 'disabled', description: 'Return from tack inspection to view your completed leg.' };
  if (boat.finished || phase === 'finished') return { disabled: true, pressed, label, state: 'disabled', description: 'Your leg is complete. Start a new leg to sail again.' };
  if (phase === 'ready') return { disabled: true, pressed, label, state: 'disabled', description: 'Start sailing to enable the mark approach.' };
  if (boat.penaltyRemaining > 1e-8) return { disabled: true, pressed, label, state: 'disabled', description: 'Mark approach is available when your tack is complete.' };
  const aim = gateAimGeometry(boat, scenario);
  const portNote = boat.tack === 'port' ? ' A finish counts only on starboard.' : '';
  if (pressed && aim.legal) return { disabled: false, pressed, label, state: 'active',
    description: (Math.abs(aim.turnDegrees) <= 0.1 ? 'Mark approach active: the clearance-safe course is already close-hauled.' : 'Mark approach active: steering as close to the windward mark as safely possible on this tack.') + portNote };
  if (pressed) return { disabled: false, pressed, label, state: 'armed',
    description: aim.reason === 'no-go'
      ? 'Mark approach armed: the safe course is inside the no-go angle, so the boat stays close-hauled until it becomes legal.'
      : aim.reason === 'opposite-tack' ? 'Mark approach armed: the mark is on the opposite tack. The boat will not tack for you; tacking returns to close-hauled.'
      : 'Mark approach armed: no clear, legal approach is available on this tack. Holding close-hauled.' };
  return { disabled: false, pressed, label, state: 'available',
    description: aim.legal ? 'Select to clear the windward mark closely, even for a small bear-away.' + portNote
      : 'Select to arm the mark approach. It waits for a safe, legal course and never changes tack automatically.' };
}
