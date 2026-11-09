import { observedFavoredSide } from './npc-strategy.js';
import { immutableNpcData } from './npc-data.js';

// Privileged race-initialization adapter, not a future-condition assessment.
// A configured side is a statistical scenario bias, not a guaranteed winner.
// The only output is one side plus provenance; no seed/route/schedule escapes.
export function initialSideIndicator(scenario, observation) {
  if (observation.time > 1e-8) throw new Error('Side indicator must be acquired at race initialization.');
  const configured = scenario.config.favoredSide;
  const known = configured === 'left' || configured === 'right';
  return immutableNpcData({ side: known ? configured : observedFavoredSide(observation),
    source: known ? 'configured-side-bias' : 'initial-present-observation' });
}
