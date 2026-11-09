import { decideLegacyComputer } from './npc-legacy-policy.js';
import { LEGACY_POLICY_ID, LEGACY_POLICY_VERSION, PERSONALITIES, skillProfile } from './npc-config.js';
import { copyNpcData, immutableNpcData, isImmutableNpcData } from './npc-data.js';
import { ROUTE_PLANNER_POLICY } from './npc-route-policy.js';

// Policy contract: decide({ observation, skill, personality, memory, commitment,
// variation }) -> { action, reason, options, memory, commitment }.
// Inputs are immutable plain data. There is no scenario, sampler, clock, RNG,
// or hindsight route in the contract. Runtime memory belongs to one NPC.
export const LEGACY_REFERENCE_POLICY = Object.freeze({
  id: LEGACY_POLICY_ID,
  version: LEGACY_POLICY_VERSION,
  decide({ observation, memory, commitment }) {
    return { ...decideLegacyComputer(observation, memory), memory, commitment };
  },
});

export function evaluateNpcPolicy({ configuration, observation, memory = {}, commitment = {} }) {
  const policy = configuration.policyId === ROUTE_PLANNER_POLICY.id ? ROUTE_PLANNER_POLICY : LEGACY_REFERENCE_POLICY;
  if (configuration.policyId !== policy.id || configuration.policyVersion !== policy.version)
    throw new Error('Unsupported NPC policy/version.');
  const result = policy.decide({
    observation: isImmutableNpcData(observation) ? observation : immutableNpcData(observation),
    skill: configuration.planning ?? skillProfile(configuration.skillId), personality: configuration.strategy ?? PERSONALITIES[configuration.personalityId],
    memory: immutableNpcData(memory), commitment: immutableNpcData(commitment), variation: configuration.variation,
  });
  // Detach output memory from immutable inputs and other instances. Decisions
  // retain the legacy action/reason/options format consumed by current views.
  return { action: result.action, reason: result.reason, options: result.options,
    memory: copyNpcData(result.memory), commitment: copyNpcData(result.commitment),
    ...(result.diagnostics ? { diagnostics: copyNpcData(result.diagnostics) } : {}) };
}
