import { DEFAULT_TRAINER_CONFIG, validateConfig } from './engine/config.js';
import { courseSettings } from './engine/course-config.js';
import { randomFromSeed } from './engine/wind.js';

export const WIND_PRESETS = {
  mixed: { label: 'Mixed / Unpredictable', description: 'Changing shifts and scattered pressure.', values: { windMode: 'oscillating', difficulty: 'medium', maxShift: 15, shiftDuration: 40, favoredSide: 'balanced', shiftDirection: 0 } },
  left: { label: 'Persistent Left Shift', description: 'A gradual counterclockwise trend within the wind field.', values: { windMode: 'persistent', difficulty: 'medium', maxShift: 15, shiftDuration: 90, persistentShiftAngle: -12, favoredSide: 'left', shiftDirection: -1 } },
  right: { label: 'Persistent Right Shift', description: 'A gradual clockwise trend within the wind field.', values: { windMode: 'persistent', difficulty: 'medium', maxShift: 15, shiftDuration: 90, persistentShiftAngle: 12, favoredSide: 'right', shiftDirection: 1 } },
  frequent: { label: 'Small, Frequent Oscillations', description: 'Short holds and smaller shifts reward quick decisions.', values: { windMode: 'oscillating', difficulty: 'hard', maxShift: 7, shiftDuration: 15, favoredSide: 'balanced', shiftDirection: 0 } },
  sparse: { label: 'Long, Sparse Oscillations', description: 'Longer holds and gradual transitions reward patience.', values: { windMode: 'oscillating', difficulty: 'easy', maxShift: 15, shiftDuration: 100, favoredSide: 'balanced', shiftDirection: 0 } },
};
export const createSetup = () => ({ ...DEFAULT_TRAINER_CONFIG, ...WIND_PRESETS.mixed.values,
  environment: 'open-water', windPreset: 'mixed', randomize: true, opponentMode: 'solo',
  current: { enabled: false, speedKnots: 0, directionDegrees: 0 }, maxCurrentKnots: 1.5 });
export function selectPreset(draft, id) {
  return { ...draft, windPreset: id, ...WIND_PRESETS[id].values };
}
export function scenarioCurrent(draft) {
  const current = { enabled: false, speedKnots: 0, directionDegrees: 0, ...draft.current };
  if (!current.enabled) return { enabled: false, speedKnots: 0, directionDegrees: 0 };
  if (!draft.randomize) return current;
  if (!Number.isFinite(draft.maxCurrentKnots) || draft.maxCurrentKnots < 0 || draft.maxCurrentKnots > 3)
    throw new Error('Maximum Current Speed must be between 0 and 3 kn.');
  // Dedicated stream, independent of wind consumption and preset parameters.
  const random = randomFromSeed(draft.seed ^ 0x63757272);
  return { enabled: true, speedKnots: random() * draft.maxCurrentKnots, directionDegrees: random() * 360 };
}
// The draft is never mutated; derived variation is reproducible and stored in session metadata.
export function sessionConfig(draft) {
  if (draft.environment !== 'open-water' || !['solo', 'npc'].includes(draft.opponentMode)) throw new Error('Unsupported environment or opponent.');
  if (!WIND_PRESETS[draft.windPreset] && draft.windPreset !== 'custom') throw new Error('Choose a wind preset.');
  const config = courseSettings({ ...draft, current: scenarioCurrent(draft) });
  validateConfig(config);
  if (draft.randomize) {
    const random = randomFromSeed(draft.seed ^ 0x71e35);
    config.shiftDuration = Math.max(2, Math.min(300, config.shiftDuration * (0.85 + random() * 0.3)));
    config.windFrequency = Math.min(12, config.windFrequency * (0.85 + random() * 0.3));
    config.maxShift = Math.min(30, config.maxShift * (0.85 + random() * 0.15));
  }
  return config;
}
