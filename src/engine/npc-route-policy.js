import { createObservedEnvironment, createForecastBudget, forecastPlan, routeNavigationAction, planAction } from './npc-forecast.js';
import { gateAimGeometry } from './physics.js';
import { recoveryRemaining } from './tack.js';
import { ROUTE_POLICY_ID, ROUTE_POLICY_VERSION } from './npc-route-config.js';
import { strategicCommitment, strategicOpportunities, rankStrategicForecasts } from './npc-strategy.js';
import { STRATEGIC_ATTRIBUTES } from './npc-personalities.js';

const opposite = tack => tack === 'starboard' ? 'port' : 'starboard';

export function generateRouteCandidates(observation, settings, memory = {}) {
  const boat = observation.boat, now = boat.time, candidates = [];
  const add = (kind, angle = null, tackAt = null, existing = null) => {
    const id = existing?.id ?? `${kind}:${boat.tack}:${angle ?? 'same'}:${tackAt ?? 'none'}`;
    if (!candidates.some(c => c.id === id)) candidates.push(existing ??
      { id, kind, angle, tackAt, startTack: boat.tack, createdAt: now });
  };
  const old = memory.plan;
  if (old && old.startTack === boat.tack &&
      (old.tackAt === null || old.tackAt >= now - settings.decisionIntervalSeconds - 1e-8)) add('incumbent', null, null, old);
  add('hold');
  const available = recoveryRemaining(boat.tackManeuver, now) <= 1e-9;
  const settled = memory.lastTackTime === null || memory.lastTackTime === undefined ||
    now - memory.lastTackTime >= settings.minimumPlanSeconds;
  if (available && settled) add('tack-now', null, now);
  for (const delay of settings.tackDelaysSeconds)
    if (delay >= recoveryRemaining(boat.tackManeuver, now)) add('deferred-tack', null, now + delay);
  for (const offset of settings.steeringOffsetsDegrees)
    add('steer', Math.min(75, observation.minAngle + offset));
  // Keep an explicit close-hauled alternative when already steering manually.
  if (boat.mode === 'manual' && boat.targetAngle > observation.minAngle + 1e-8) add('steer', observation.minAngle);
  return candidates.slice(0, settings.maxCandidates);
}

export function generateStrategicRouteCandidates(o, settings, memory = {}) {
  const base = generateRouteCandidates(o, settings, memory);
  const extras = strategicOpportunities(o, settings).filter(ray => ray.tack === o.tack || base.some(p => p.kind === 'tack-now'))
    .map(ray => ({ id: `corridor:${ray.tack}:${ray.angle}`, kind: 'corridor', startTack: o.tack,
      angle: ray.tack === o.tack ? ray.angle : null, postTackAngle: ray.tack === o.tack ? null : ray.angle,
      tackAt: ray.tack === o.tack ? null : o.time, createdAt: o.time }));
  const candidates = [];
  const add = plan => {
    const angle = plan.angle ?? (plan.tackAt === null ? null : plan.postTackAngle ?? o.minAngle);
    const key = `${plan.tackAt ?? 'none'}:${angle ?? 'hold'}`;
    if (!candidates.some(p => p.id === plan.id || p.motionKey === key)) candidates.push({ ...plan, motionKey: key });
  };
  // Reserve space for actionable common opportunities, preserving incumbent,
  // hold, immediate tack and at least one deferred timing when available.
  const reserved = Math.min(extras.length, Math.max(1, settings.maxCandidates - 4));
  base.slice(0, settings.maxCandidates - reserved).forEach(add);
  extras.forEach(add); base.forEach(add);
  return candidates.slice(0, settings.maxCandidates);
}

const metrics = (settings, candidateCount = 0, forecastSteps = 0, budgetExhausted = false) => ({
  candidateCount, forecastSteps, stepBudget: settings.maxIntegrationSteps, budgetExhausted, model: settings.forecastModel,
});

export function decideRoutePlanner({ observation: o, skill: settings, personality = {}, memory = {}, commitment = {} }) {
  const boat = o.boat, now = boat.time;
  const strategy = personality.weights ? personality : null;
  if (strategy) commitment = strategicCommitment(o, strategy, commitment);
  const environment = createObservedEnvironment(o);
  const navigate = routeNavigationAction(boat, environment);
  const finishApproach = boat.mode === 'gate' && gateAimGeometry(boat, environment).legal;
  if (navigate || finishApproach) {
    const reason = navigate === 'tack' ? 'Tacking for a legal current-adjusted finite course approach.'
      : navigate === 'close' ? 'The observed approach is no longer reachable; returning to close-hauled navigation.'
        : 'Following the legal current-adjusted finite course approach.';
    return { action: navigate ?? 'hold', reason, options: [], commitment,
      memory: { ...memory, plan: null, expectedSeconds: null, lastReason: reason,
        invalidation: memory.plan ? 'mandatory-navigation' : null }, diagnostics: metrics(settings) };
  }
  if (strategy && memory.plan?.postTackAngle !== null && memory.plan?.postTackAngle !== undefined && boat.tack !== memory.plan.startTack) {
    const postTack = planAction(memory.plan, boat);
    if (typeof postTack === 'object') {
      const reason = 'Following the planned corridor heading after the shared turn; recovery physics remains active.';
      return { action: postTack, reason, options: [], commitment, memory: { ...memory, lastReason: reason }, diagnostics: metrics(settings) };
    }
  }
  if (recoveryRemaining(boat.tackManeuver, now) > 1e-9) {
    const reason = 'Completing the shared tack and recovery before strategic replanning.';
    return { action: 'hold', reason, options: [], commitment, memory: { ...memory, lastReason: reason }, diagnostics: metrics(settings) };
  }
  const candidates = strategy ? generateStrategicRouteCandidates(o, settings, memory) : generateRouteCandidates(o, settings, memory);
  const budget = createForecastBudget(settings.maxIntegrationSteps);
  const forecasts = candidates.map(plan => forecastPlan(o, plan, settings, budget, !!strategy));
  const complete = forecasts.filter(f => !f.exhausted);
  const finite = complete.filter(f => f.estimatedSeconds !== null);
  const incumbent = complete.find(f => f.plan.id === memory.plan?.id);
  let best = finite.reduce((a, b) => !a || b.estimatedSeconds < a.estimatedSeconds - 1e-8 ? b : a, null);
  const strategic = strategy ? rankStrategicForecasts(forecasts, o, strategy, commitment, memory, settings) : null;
  if (strategic?.ranked.length) best = strategic.ranked[0].forecast;
  let retained = false;
  if (strategy && strategic.ranked.length) {
    const previous = strategic.ranked.find(r => r.forecast === incumbent);
    const threshold = settings.switchingThresholdSeconds / strategic.etaBudgetSeconds * strategy.weights.route / 100 *
      (now - (memory.lastStrategicChange ?? -Infinity) < settings.minimumPlanSeconds ? 2 : 1);
    if (previous && strategic.ranked[0].utility - previous.utility <= threshold) { best = previous.forecast; retained = true; }
  } else if (!strategy && best && incumbent?.estimatedSeconds !== null && incumbent?.estimatedSeconds !== undefined) {
    const gain = incumbent.estimatedSeconds - best.estimatedSeconds;
    const threshold = settings.switchingThresholdSeconds *
      (now - (memory.lastStrategicChange ?? -Infinity) < settings.minimumPlanSeconds ? 2 : 1);
    if (gain <= threshold) { best = incumbent; retained = true; }
  }
  // If no legal continuation is found, do not manufacture a finite arrival
  // estimate. Ground progress is only a recovery fallback, never an ETA bonus.
  if (!best) best = complete.reduce((a, b) => !a || b.progressMeters > a.progressMeters + 1e-8 ? b : a, null);
  const plan = best?.plan ?? { id: `hold:${boat.tack}:same:none`, kind: 'hold', angle: null,
    tackAt: null, startTack: boat.tack, createdAt: now };
  const action = planAction(plan, boat);
  let reason = best?.estimatedSeconds === null || !best
    ? 'No finite legal ETA found in the observed model; choosing bounded ground progress without assuming arrival.'
    : retained ? 'Keeping the current plan: alternatives do not improve estimated legal finish time enough.'
      : plan.tackAt !== null && plan.tackAt > now
        ? `Continue, then evaluate the planned tack at ${plan.tackAt.toFixed(2)} simulation seconds; current is included.`
        : 'Selecting the lowest estimated legal finish time from shared-physics, current-aware forecasts.';
  const selected = strategic?.ranked.find(r => r.forecast === best);
  if (selected) {
    const fastest = [...strategic.ranked].sort((a, b) => a.forecast.estimatedSeconds - b.forecast.estimatedSeconds)[0];
    const gains = STRATEGIC_ATTRIBUTES.filter(key => key !== 'route').map(key => ({ key,
      gain: strategy.weights[key] / 100 * (selected.scores[key] - fastest.scores[key]) })).sort((a, b) => b.gain - a.gain);
    reason = retained ? `${strategy.label}: retaining the competitive strategic plan within switching hysteresis.`
      : gains[0].gain > 1e-6 ? `${strategy.label}: favoring ${gains[0].key} within the ${strategic.etaBudgetSeconds.toFixed(1)} s ETA-regret limit.`
        : `${strategy.label}: selecting the fastest eligible legal route; no strategic detour is justified.`;
  }
  const changed = plan.id !== memory.plan?.id;
  const invalidation = memory.plan && memory.plan.startTack !== boat.tack ? 'maneuver-completed-or-tack-changed'
    : memory.plan?.tackAt !== null && memory.plan?.tackAt !== undefined &&
        memory.plan.tackAt < now - settings.decisionIntervalSeconds - 1e-8 ? 'planned-tack-expired'
    : incumbent?.estimatedSeconds === null && best?.estimatedSeconds !== null ? 'continuation-unreachable' : null;
  return { action, reason, commitment,
    options: forecasts.map(f => ({ candidateId: f.plan.id, kind: f.plan.kind, estimatedSeconds: f.estimatedSeconds,
      forecastSeconds: f.elapsed, forecastSteps: f.steps, predictedFinish: f.boat.finished,
      reachable: f.terminal.reachable, budgetExhausted: f.exhausted, position: { ...f.boat.position },
      ...(strategy ? { features: f.features, attributeScores: strategic.ranked.find(r => r.forecast === f)?.scores ?? null,
        weightedUtility: strategic.ranked.find(r => r.forecast === f)?.utility ?? null } : {}) })),
    memory: { ...memory, plan, intendedTack: plan.tackAt === null ? boat.tack : opposite(plan.startTack),
      expectedSeconds: best?.estimatedSeconds ?? null, lastStrategicChange: changed ? now : memory.lastStrategicChange ?? now,
      forecastModel: settings.forecastModel, lastReason: reason, invalidation,
      ...(strategy ? { strategy: { profileId: strategy.profileId, utility: selected?.utility ?? null,
        scores: selected?.scores ?? null, etaBudgetSeconds: strategic.etaBudgetSeconds } } : {}) },
    diagnostics: metrics(settings, candidates.length, budget.used, forecasts.some(f => f.exhausted)) };
}

export const ROUTE_PLANNER_POLICY = Object.freeze({ id: ROUTE_POLICY_ID, version: ROUTE_POLICY_VERSION, decide: decideRoutePlanner });
