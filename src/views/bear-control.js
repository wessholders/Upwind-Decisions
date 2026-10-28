import { gateAimGeometry } from '../engine/physics.js';
import { courseRules, isUpwindFinish } from '../engine/course-config.js';

export function bearControlView({ boat, scenario, phase, inspection = null }) {
  const pressed = boat.mode === 'gate';
  const upwind = isUpwindFinish(scenario.config), rules = courseRules(scenario.config);
  const label = pressed ? 'Return close-hauled' : upwind ? 'Bear away to finish' : 'Bear away to mark';
  if (inspection) return { disabled: true, pressed, label, state: 'disabled', description: 'Return from tack inspection to view your completed leg.' };
  if (boat.finished || phase === 'finished') return { disabled: true, pressed, label, state: 'disabled', description: 'Your leg is complete. Start a new leg to sail again.' };
  if (phase === 'ready') return { disabled: true, pressed, label, state: 'disabled', description: `Start sailing to enable the ${upwind ? 'finish' : 'mark'} approach.` };
  if (boat.penaltyRemaining > 1e-8) return { disabled: true, pressed, label, state: 'disabled', description: `${upwind ? 'Finish' : 'Mark'} approach is available when your tack is complete.` };
  const aim = gateAimGeometry(boat, scenario);
  const portNote = rules.requiredTack && boat.tack !== rules.requiredTack ? ` A finish counts only on ${rules.requiredTack}.` : '';
  if (upwind) return { disabled: false, pressed, label,
    state: pressed ? aim.legal ? 'active' : 'armed' : 'available',
    description: pressed ? aim.legal ? 'Finish approach active: steering to a legal crossing between the fixed pins.'
      : 'Finish approach armed: holding close-hauled until a crossing is legal on this tack. Tacking cancels aiming.'
      : 'Select to aim at the finite finish line when it becomes reachable. Either tack may finish; the boat never tacks for you.' };
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
