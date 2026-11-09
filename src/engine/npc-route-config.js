import { immutableNpcData } from './npc-data.js';

export const ROUTE_POLICY_ID = 'route-planner-v2';
export const ROUTE_POLICY_VERSION = 1;
export const ROUTE_SKILL_VERSION = 2;

// Provisional computational/commitment settings, not a ranking of empirically
// demonstrated skill. All candidates use the same boat and forecast physics.
export const ROUTE_PLANNING_PROFILES = immutableNpcData({
  beginner: { decisionIntervalSeconds: 4, horizonSeconds: 20, maxCandidates: 5, maxIntegrationSteps: 1200,
    tackDelaysSeconds: [8], steeringOffsetsDegrees: [8], switchingThresholdSeconds: 3, minimumPlanSeconds: 6,
    forecastModel: 'frozen-present-v1' },
  intermediate: { decisionIntervalSeconds: 2, horizonSeconds: 40, maxCandidates: 8, maxIntegrationSteps: 2600,
    tackDelaysSeconds: [8, 16], steeringOffsetsDegrees: [6, 12], switchingThresholdSeconds: 2, minimumPlanSeconds: 8,
    forecastModel: 'frozen-present-v1' },
  advanced: { decisionIntervalSeconds: 2, horizonSeconds: 60, maxCandidates: 10, maxIntegrationSteps: 4000,
    tackDelaysSeconds: [8, 16, 28], steeringOffsetsDegrees: [4, 8, 12], switchingThresholdSeconds: 1.5, minimumPlanSeconds: 10,
    forecastModel: 'frozen-present-v1' },
});

export function routePlanningProfile(skillId = 'advanced', overrides = {}) {
  const base = ROUTE_PLANNING_PROFILES[skillId];
  if (!base || !overrides || typeof overrides !== 'object' || Array.isArray(overrides) ||
      Object.keys(overrides).some(key => !Object.hasOwn(base, key))) throw new Error('Invalid route planning profile.');
  const p = { ...base, ...overrides };
  const quarter = n => Number.isFinite(n) && Math.abs(n * 4 - Math.round(n * 4)) < 1e-9;
  if (!quarter(p.decisionIntervalSeconds) || p.decisionIntervalSeconds < 1 || p.decisionIntervalSeconds > 8 ||
      !quarter(p.horizonSeconds) || p.horizonSeconds < 8 || p.horizonSeconds > 90 ||
      !Number.isInteger(p.maxCandidates) || p.maxCandidates < 5 || p.maxCandidates > 12 ||
      !Number.isInteger(p.maxIntegrationSteps) || p.maxIntegrationSteps < 100 || p.maxIntegrationSteps > 6000 ||
      !Array.isArray(p.tackDelaysSeconds) || p.tackDelaysSeconds.length > 4 ||
      !p.tackDelaysSeconds.every(n => quarter(n) && n > 0 && n < p.horizonSeconds) ||
      !Array.isArray(p.steeringOffsetsDegrees) || p.steeringOffsetsDegrees.length > 4 ||
      !p.steeringOffsetsDegrees.every(n => Number.isFinite(n) && n > 0 && n <= 20) ||
      !Number.isFinite(p.switchingThresholdSeconds) || p.switchingThresholdSeconds < 0 || p.switchingThresholdSeconds > 15 ||
      !Number.isFinite(p.minimumPlanSeconds) || p.minimumPlanSeconds < 0 || p.minimumPlanSeconds > 30 ||
      p.forecastModel !== 'frozen-present-v1') throw new Error('Route planning settings exceed supported deterministic bounds.');
  return immutableNpcData(p);
}
