import { immutableNpcData } from './npc-data.js';
import { ROUTE_POLICY_ID, ROUTE_POLICY_VERSION, ROUTE_SKILL_VERSION, routePlanningProfile } from './npc-route-config.js';
import { personalityPreset, strategicConfiguration, VALIDATED_ELITE_SKILL } from './npc-personalities.js';

export const NPC_SCHEMA_VERSION = 1;
export const LEGACY_POLICY_ID = 'legacy-reference';
export const LEGACY_POLICY_VERSION = 1;

// Versioned observation profiles. Local distances use course axes, not the
// boat's changing heading. Values are provisional engineering fixtures,
// expressed in boat lengths; they are not validated difficulty tuning.
export const OBSERVATION_PROFILES = immutableNpcData({
  'legacy-v1': { id: 'legacy-v1', coverage: 'legacy-course', cols: 17, rows: 21,
    upstreamLimit: 'legacy-unbounded', precision: 'exact-vectors' },
  'beginner-v1': { id: 'beginner-v1', coverage: 'boat-relative', cols: 9, rows: 11,
    forwardBoatLengths: 40, aftBoatLengths: 10, lateralBoatLengths: 20,
    upstreamLimit: 'wind-entry', precision: 'exact-vectors' },
  'intermediate-v1': { id: 'intermediate-v1', coverage: 'boat-relative', cols: 13, rows: 17,
    forwardBoatLengths: 90, aftBoatLengths: 15, lateralBoatLengths: 50,
    upstreamLimit: 'wind-entry', precision: 'exact-vectors' },
  'advanced-v1': { id: 'advanced-v1', coverage: 'boat-relative', cols: 17, rows: 21,
    forwardBoatLengths: 220, aftBoatLengths: 16, lateralBoatLengths: 116,
    upstreamLimit: 'wind-entry', precision: 'exact-vectors' },
});

// The legacy reference is deliberately unrated. Named skill profiles opt into
// different observations only. Their remaining planning fields describe the
// existing capabilities and are extension points, not a new planner or tuning.
const planning = {
  version: 1, decisionIntervalSeconds: 2, planningHorizonSeconds: 60,
  planningDepth: 1, computationalBudget: { maxCandidateActions: 2 },
  environmentalInterpretation: 'frozen-present-map',
  hysteresis: { mode: 'legacy-fixed', minimumSettlingSeconds: 12, extraTurnSeconds: 4 },
};
export const REFERENCE_SKILL_PROFILE = immutableNpcData({
  ...planning, id: null, label: 'Unrated legacy reference', observationProfileId: 'legacy-v1',
});
export const SKILL_PROFILES = immutableNpcData(Object.fromEntries(
  [['beginner', 'Beginner'], ['intermediate', 'Intermediate'], ['advanced', 'Advanced']]
    .map(([id, label]) => [id, { ...planning, id, label, observationProfileId: `${id}-v1` }]),
));

export const PERSONALITIES = immutableNpcData(Object.fromEntries([
  'all_rounder', 'puff_hunter', 'shift_hunter', 'tack_minimalist', 'side_specialist', 'current_strategist',
].map(id => [id, { id, version: 1, status: 'identifier-only' }])));

// Roster metadata only. No fleet is created and no unvalidated elite policy is
// assigned. The existing live opponent remains the single legacy reference.
export const PLANNED_NPC_ROSTER = immutableNpcData([
  { id: 'elite-all-rounder', slot: 1, personalityId: 'all_rounder', skillAssignment: 'strongest-validated-planner' },
  { id: 'all-rounder-2', slot: 2, personalityId: 'all_rounder', skillAssignment: 'seeded-variable' },
  { id: 'all-rounder-3', slot: 3, personalityId: 'all_rounder', skillAssignment: 'seeded-variable' },
  { id: 'puff-hunter', slot: 4, personalityId: 'puff_hunter', skillAssignment: 'unassigned' },
  { id: 'shift-hunter', slot: 5, personalityId: 'shift_hunter', skillAssignment: 'unassigned' },
  { id: 'tack-minimalist', slot: 6, personalityId: 'tack_minimalist', skillAssignment: 'unassigned' },
  { id: 'side-specialist', slot: 7, personalityId: 'side_specialist', skillAssignment: 'unassigned' },
  { id: 'current-strategist', slot: 8, personalityId: 'current_strategist', skillAssignment: 'unassigned' },
]);

export function skillProfile(id) {
  if (id === null) return REFERENCE_SKILL_PROFILE;
  if (!Object.hasOwn(SKILL_PROFILES, id)) throw new Error('Unknown NPC skill profile.');
  return SKILL_PROFILES[id];
}

export function observationProfile(profile = 'legacy-v1') {
  const value = typeof profile === 'string' ? OBSERVATION_PROFILES[profile] : profile;
  if (!value || !Number.isInteger(value.cols) || !Number.isInteger(value.rows) ||
      value.cols < 2 || value.rows < 2 || value.cols > 65 || value.rows > 65 ||
      value.precision !== 'exact-vectors' || typeof value.id !== 'string' || !value.id)
    throw new Error('Invalid NPC observation profile.');
  if (value.coverage === 'legacy-course') {
    if (value.id !== 'legacy-v1' || value.cols !== 17 || value.rows !== 21 || value.upstreamLimit !== 'legacy-unbounded')
      throw new Error('The legacy observation profile is fixed.');
  } else if (value.coverage !== 'boat-relative' || value.upstreamLimit !== 'wind-entry' ||
      !['forwardBoatLengths', 'aftBoatLengths', 'lateralBoatLengths'].every(key =>
        Number.isFinite(value[key]) && value[key] > 0 && value[key] <= 2000)) {
    throw new Error('Restricted observations require positive extents and a wind-entry limit.');
  }
  return value;
}

export function createNpcConfiguration({ schemaVersion = NPC_SCHEMA_VERSION, strategy = null,
  personalityProfileId = strategy?.profileId ?? null, attributeWeights = null,
  id = personalityProfileId ?? 'legacy-computer', policyId = personalityProfileId ? ROUTE_POLICY_ID : LEGACY_POLICY_ID,
  policyVersion = LEGACY_POLICY_VERSION,
  skillId = personalityProfileId ? personalityPreset(personalityProfileId).defaultSkillId : policyId === ROUTE_POLICY_ID ? 'advanced' : null,
  skillProfileVersion = policyId === ROUTE_POLICY_ID ? ROUTE_SKILL_VERSION : 1,
  personalityId = personalityProfileId ? personalityPreset(personalityProfileId).personalityId : 'all_rounder',
  personalityVersion = personalityProfileId ? 2 : 1,
  observationProfileId = skillProfile(skillId).observationProfileId, variation = null, planning = null } = {}) {
  const route = policyId === ROUTE_POLICY_ID;
  if (schemaVersion !== NPC_SCHEMA_VERSION || typeof id !== 'string' || !id.trim() ||
      (route ? policyVersion !== ROUTE_POLICY_VERSION || skillProfileVersion !== ROUTE_SKILL_VERSION
        : policyId !== LEGACY_POLICY_ID || policyVersion !== LEGACY_POLICY_VERSION || skillProfileVersion !== 1) ||
      personalityVersion !== (personalityProfileId ? 2 : 1))
    throw new Error('Unsupported NPC identity or configuration version.');
  skillProfile(skillId);
  if (!Object.hasOwn(PERSONALITIES, personalityId)) throw new Error('Unknown NPC personality.');
  if (typeof observationProfileId !== 'string' || !Object.hasOwn(OBSERVATION_PROFILES, observationProfileId))
    throw new Error('NPC configuration requires a registered observation profile ID.');
  observationProfile(observationProfileId);
  if (route && (skillId === null || observationProfileId === 'legacy-v1'))
    throw new Error('The route planner requires a named skill and capped observations.');
  if (!route && planning !== null) throw new Error('Legacy planning settings are fixed.');
  const resolvedPlanning = route ? routePlanningProfile(skillId, planning ?? {}) : null;
  if (!personalityProfileId && (strategy !== null || attributeWeights !== null)) throw new Error('Weights require an explicit personality preset.');
  if (personalityProfileId && (!route || personalityPreset(personalityProfileId).personalityId !== personalityId))
    throw new Error('Weighted personalities require the route planner and matching personality identifier.');
  const resolvedStrategy = personalityProfileId ? strategicConfiguration(personalityProfileId, attributeWeights ?? strategy?.weights ?? null) : null;
  if (strategy && (strategy.version !== 1 || strategy.profileId !== personalityProfileId ||
      Object.keys(strategy).some(key => !Object.hasOwn(resolvedStrategy, key)) ||
      ['id', 'commitSide', 'maxEtaRegretFraction', 'maxEtaRegretSeconds'].some(key => strategy[key] !== resolvedStrategy[key])))
    throw new Error('Unsupported strategic configuration.');
  if (variation !== null && (!variation || !Number.isInteger(variation.seed) || variation.seed < 0 ||
      variation.seed > 4294967295 || !variation.parameters || typeof variation.parameters !== 'object' || Array.isArray(variation.parameters)))
    throw new Error('NPC variation requires a uint32 seed and plain parameters.');
  return immutableNpcData({ schemaVersion, id, policyId, policyVersion, skillId, skillProfileVersion,
    personalityId, personalityVersion, observationProfileId, variation,
    ...(route ? { planning: resolvedPlanning } : {}),
    ...(resolvedStrategy ? { personalityProfileId, strategy: resolvedStrategy } : {}) });
}

export function createPersonalityConfiguration(profileId, overrides = {}) {
  if (profileId === 'elite-all-rounder' && overrides.skillId !== undefined && overrides.skillId !== VALIDATED_ELITE_SKILL)
    throw new Error('Elite factory uses the strongest validated skill; use explicit experimental configuration for skill comparisons.');
  return createNpcConfiguration({ ...overrides, personalityProfileId: profileId });
}
