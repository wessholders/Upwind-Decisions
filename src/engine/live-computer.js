import { advance, applyAction, initialBoat } from './physics.js';
import { KNOT_TO_MPS } from './config.js';
import { referenceSpeedKnots } from './performance.js';
import { observeCurrentWind, observeRoutePlanner } from './npc-observation.js';
import { ROUTE_POLICY_ID } from './npc-route-config.js';
import { createNpcConfiguration, skillProfile } from './npc-config.js';
import { evaluateNpcPolicy } from './npc-policy.js';
import { initialSideIndicator } from './npc-side-indicator.js';

// Existing imports remain source-compatible; implementation has one owner.
export { observeCurrentWind, sampleObservedMap } from './npc-observation.js';
export { forecastObservedOption, decideLegacyComputer as decideLiveComputer } from './npc-legacy-policy.js';

export function createLiveComputer(configuration = {}) {
  const boat = initialBoat();
  const config = createNpcConfiguration(configuration);
  return { configuration: config, planningMemory: {}, commitment: {},
    statistics: { decisions: 0, candidates: 0, forecastSteps: config.policyId === ROUTE_POLICY_ID ? 0 : null, budgetExhaustions: 0 },
    boat, track: [boat], commands: [], decisions: [], nextDecision: 0, lastTackTime: -Infinity,
    status: 'ready', latestReason: 'Uses current wind observations, with no future wind schedule.' };
}

export function advanceLiveComputer(computer, scenario, duration) {
  if (computer.boat.finished || computer.status === 'timed-out') return;
  computer.status = 'racing';
  const boat = computer.boat;
  if (boat.time + 1e-8 >= computer.nextDecision) {
    const config = computer.configuration;
    const observation = config.policyId === ROUTE_POLICY_ID ? observeRoutePlanner(scenario, boat, config.observationProfileId)
      : observeCurrentWind(scenario, boat, config.observationProfileId);
    if (config.strategy?.commitSide && !computer.commitment.courseSide) {
      const indicator = initialSideIndicator(scenario, observation);
      computer.commitment = { ...computer.commitment, courseSide: { ...indicator, initializedAt: boat.time, locked: true } };
    }
    const choice = evaluateNpcPolicy({ configuration: config, observation,
      memory: { ...computer.planningMemory, lastTackTime: Number.isFinite(computer.lastTackTime) ? computer.lastTackTime : null },
      commitment: computer.commitment });
    computer.statistics.decisions++;
    computer.statistics.candidates += choice.diagnostics?.candidateCount ?? choice.options.length;
    if (choice.diagnostics) {
      computer.statistics.forecastSteps += choice.diagnostics.forecastSteps;
      if (choice.diagnostics.budgetExhausted) computer.statistics.budgetExhaustions++;
    }
    computer.planningMemory = choice.memory; computer.commitment = choice.commitment;
    computer.latestReason = choice.reason;
    const interval = config.planning?.decisionIntervalSeconds ?? skillProfile(config.skillId).decisionIntervalSeconds;
    const phase = computer.planningSchedule?.phaseSeconds;
    computer.nextDecision = phase === undefined ? boat.time + interval
      : phase + (Math.floor((boat.time - phase + 1e-8) / interval) + 1) * interval;
    if (choice.diagnostics) {
      computer.planningDiagnostics = choice.diagnostics;
      const due = computer.planningMemory.plan?.tackAt;
      if (due !== null && due !== undefined && due > boat.time + 1e-8)
        computer.nextDecision = Math.min(computer.nextDecision, due);
      const turnEnd = boat.tackManeuver ? boat.tackManeuver.start + boat.tackManeuver.duration : null;
      if (config.strategy && computer.planningMemory.plan?.postTackAngle !== null &&
          computer.planningMemory.plan?.postTackAngle !== undefined && turnEnd !== null && turnEnd > boat.time + 1e-8)
        computer.nextDecision = Math.min(computer.nextDecision, turnEnd);
    }
    if (choice.action !== 'hold') {
      const next = applyAction(boat, choice.action, scenario);
      if (next !== boat && (choice.action !== 'bear' || boat.mode !== 'gate')) {
        computer.commands.push({ time: boat.time, action: choice.action });
        computer.decisions.push({ time: boat.time, action: choice.action, reason: choice.reason,
          fromTack: boat.tack, toTack: next.tack, position: { ...boat.position }, wind: observation.wind, options: choice.options });
        computer.boat = next;
        if (config.strategy && computer.planningMemory.plan?.postTackAngle !== null &&
            computer.planningMemory.plan?.postTackAngle !== undefined && next.tackManeuver) {
          const turnEnd = next.tackManeuver.start + next.tackManeuver.duration;
          if (turnEnd > boat.time + 1e-8) computer.nextDecision = Math.min(computer.nextDecision, turnEnd);
        }
        if (choice.action === 'tack') {
          computer.lastTackTime = boat.time; computer.planningMemory.lastTackTime = boat.time;
        }
      }
    }
  }
  computer.boat = advance(computer.boat, scenario, duration);
  const last = computer.track.at(-1);
  if (computer.boat.time - last.time >= 1 || computer.boat.finished) computer.track.push(computer.boat);
  if (computer.boat.finished) { computer.status = 'finished'; computer.latestReason = 'Finished using live wind observations only.'; }
  else if (computer.boat.time > scenario.config.courseLength / (referenceSpeedKnots(scenario.config) * KNOT_TO_MPS * 0.5) * 4 + 300)
    computer.status = 'timed-out';
}
