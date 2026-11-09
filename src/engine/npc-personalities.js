import { immutableNpcData } from './npc-data.js';

export const STRATEGIC_ATTRIBUTES = Object.freeze(['pressure', 'shifts', 'tacks', 'side', 'current', 'route']);
// Selected after the fixed-seed skill comparison recorded in NPC_PHASE_3.md.
// This is a suite-qualified choice, not a claim of universal superiority.
export const VALIDATED_ELITE_SKILL = 'beginner';

const rows = [
  ['elite-all-rounder', 'Elite All-Rounder', 'all_rounder', [17, 17, 12, 6, 18, 30]],
  ['all-rounder-2', 'All-Rounder 2', 'all_rounder', [20, 17, 12, 6, 15, 30]],
  ['all-rounder-3', 'All-Rounder 3', 'all_rounder', [17, 20, 12, 6, 15, 30]],
  ['puff-hunter', 'Puff Hunter', 'puff_hunter', [50, 10, 8, 4, 8, 20]],
  ['shift-hunter', 'Shift Hunter', 'shift_hunter', [10, 50, 8, 4, 8, 20]],
  ['tack-minimalist', 'Tack Minimalist', 'tack_minimalist', [10, 10, 45, 5, 10, 20]],
  ['side-specialist', 'Side Specialist', 'side_specialist', [10, 10, 8, 45, 7, 20]],
  ['current-strategist', 'Current Strategist', 'current_strategist', [10, 10, 8, 4, 48, 20]],
];
export const NPC_PERSONALITY_PRESETS = immutableNpcData(Object.fromEntries(rows.map(([id, label, personalityId, weights]) =>
  [id, { id, label, personalityId, version: 2, status: 'weighted',
    defaultSkillId: id === 'elite-all-rounder' ? VALIDATED_ELITE_SKILL : 'intermediate',
    weights: Object.fromEntries(STRATEGIC_ATTRIBUTES.map((name, i) => [name, weights[i]])),
    commitSide: id === 'side-specialist' }])));

export function personalityPreset(id) {
  if (!Object.hasOwn(NPC_PERSONALITY_PRESETS, id)) throw new Error('Unknown NPC personality preset.');
  return NPC_PERSONALITY_PRESETS[id];
}

export function strategicConfiguration(profileId, weights = null) {
  const preset = personalityPreset(profileId);
  if (weights !== null && (!weights || typeof weights !== 'object' || Array.isArray(weights) ||
      Object.keys(weights).some(key => !STRATEGIC_ATTRIBUTES.includes(key)))) throw new Error('Invalid strategic weights.');
  const values = { ...preset.weights, ...weights };
  if (!Object.values(values).every(n => Number.isFinite(n) && n >= 0)) throw new Error('Weights must be finite and nonnegative.');
  const total = Object.values(values).reduce((a, b) => a + b, 0);
  if (total <= 0) throw new Error('Strategic weights must have positive total weight.');
  return immutableNpcData({ version: 1, profileId, id: preset.personalityId, label: preset.label,
    weights: Object.fromEntries(STRATEGIC_ATTRIBUTES.map(key => [key, Math.abs(total - 100) < 1e-9 ? values[key] : values[key] * 100 / total])),
    commitSide: preset.commitSide, maxEtaRegretFraction: 0.08, maxEtaRegretSeconds: 30 });
}
