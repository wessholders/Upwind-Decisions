import { randomFromSeed } from './wind.js';
import { immutableNpcData } from './npc-data.js';
import { createPersonalityConfiguration } from './npc-config.js';
import { ROUTE_PLANNING_PROFILES } from './npc-route-config.js';
import { VALIDATED_ELITE_SKILL } from './npc-personalities.js';
import { createLiveComputer, advanceLiveComputer } from './live-computer.js';
import { initialBoat } from './physics.js';
import { courseGeometry, nearestFinishPoint } from './course.js';

export const FLEET_COLORS = Object.freeze(['#855ab1', '#b64445', '#087f94', '#c4661b', '#397444', '#aa4388', '#405db7', '#77842c', '#74513d']);
const tierNames = ['Beginner', 'Intermediate', 'Advanced', 'Elite'];
const skillIds = ['beginner', 'intermediate', 'advanced', VALIDATED_ELITE_SKILL];

export function requestedNpcCount(config) {
  if (config.npcCount !== undefined && (!Number.isInteger(config.npcCount) || config.npcCount < 0 || config.npcCount > 8))
    throw new Error('NPC count must be an integer from 0 to 8.');
  return config.opponentMode === 'solo' ? 0 : config.npcCount ?? 1;
}

const shuffle = (items, random) => {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1)); [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
};

// Fully materialized spawn/configuration records make restart/replay independent
// of later random consumption. All streams are separate from the wind generator.
export function createFleetDescriptor(config) {
  const count = requestedNpcCount(config), random = randomFromSeed(config.seed ^ 0x666c6565);
  const lanes = shuffle(Array.from({ length: count }, (_, i) => (i % 2 ? -1 : 1) * (Math.floor(i / 2) + 1)), random);
  const phases = shuffle(Array.from({ length: count }, (_, i) => i * 0.25), random);
  const colors = FLEET_COLORS.filter(color => color !== config.boatColor);
  const entries = Array.from({ length: count }, (_, index) => {
    const tier = index === count - 1 ? 3 : Math.min(2, Math.floor(index * 3 / Math.max(1, count - 1)));
    const seed = (config.seed ^ Math.imul(index + 1, 0x9e3779b9) ^ 0x61726e70) >>> 0;
    const variation = randomFromSeed(seed), skillId = skillIds[tier];
    const profile = tier === 3 ? 'elite-all-rounder' : index % 2 ? 'all-rounder-3' : 'all-rounder-2';
    const base = ROUTE_PLANNING_PROFILES[skillId];
    // Elite keeps its validated planner settings. Its seeded lane/phase still
    // supplies independent variation. Other boats vary commitment slightly,
    // without changing strategy weights, cadence, horizons, or physical inputs.
    const thresholdFactor = tier === 3 ? 1 : 0.95 + variation() * 0.1;
    const commitmentOffset = tier === 3 ? 0 : variation() - 0.5;
    const start = { x: lanes[index] * config.boatLength * 3, y: 0 };
    const id = `npc-${index + 1}`;
    return { id, label: `All-Rounder ${index + 1}`, shortLabel: `AR${index + 1}`, role: 'npc', control: 'policy',
      color: colors[index], tier: tierNames[tier], start, planningPhaseSeconds: phases[index],
      configuration: createPersonalityConfiguration(profile, { id, skillId,
        planning: { switchingThresholdSeconds: base.switchingThresholdSeconds * thresholdFactor,
          minimumPlanSeconds: base.minimumPlanSeconds + commitmentOffset },
        variation: { seed, parameters: { thresholdFactor, commitmentOffset, start, planningPhaseSeconds: phases[index] } } }) };
  });
  return immutableNpcData({ version: 1, seed: config.seed, count, entries });
}

export function instantiateFleet(descriptor) {
  if (descriptor.version !== 1 || !Number.isInteger(descriptor.count) || descriptor.count < 0 || descriptor.count > 8 ||
      !Array.isArray(descriptor.entries) || descriptor.entries.length !== descriptor.count)
    throw new Error('Unsupported fleet descriptor.');
  const npcs = descriptor.entries.map(entry => {
    const npc = createLiveComputer(entry.configuration);
    npc.identity = immutableNpcData({ id: entry.id, label: entry.label, shortLabel: entry.shortLabel,
      role: entry.role, control: entry.control, color: entry.color, tier: entry.tier });
    npc.boat = { ...initialBoat(), position: { ...entry.start } };
    npc.initialBoat = immutableNpcData(npc.boat); npc.track = [npc.boat];
    npc.planningSchedule = { phaseSeconds: entry.planningPhaseSeconds };
    npc.nextDecision = entry.planningPhaseSeconds;
    return npc;
  });
  return { descriptor: immutableNpcData(descriptor), npcs };
}

export const npcIsActive = npc => !npc.boat.finished && npc.status !== 'timed-out';
export const fleetIsActive = state => state.npcs.some(npcIsActive);

export function advanceFleet(npcs, scenario, duration) {
  for (const npc of npcs) advanceLiveComputer(npc, scenario, duration);
}

// Standings consume generic entrant records, not personality/controller types.
// Another local or future network-controlled human can use this same surface.
export function raceEntrants(state) {
  return [{ id: 'player', label: 'You', shortLabel: 'YOU', role: 'human', control: 'local',
    color: state.boatColor ?? state.scenario.config.boatColor ?? '#246caa', tier: 'Human',
    boat: state.boat, status: state.boat.finished ? 'finished' : state.phase },
  ...state.npcs.map(npc => ({ ...(npc.identity ?? { id: npc.configuration.id, label: 'Live computer', shortLabel: 'NPC',
    role: 'npc', control: 'policy', color: '#855ab1', tier: 'Reference' }), boat: npc.boat, status: npc.status }))];
}

export function raceStandings(scenario, entrants, time = 0) {
  const geometry = courseGeometry(scenario, time);
  const rows = entrants.map(entrant => {
    const target = nearestFinishPoint(entrant.boat.position, geometry);
    return { id: entrant.id, label: entrant.label, shortLabel: entrant.shortLabel, color: entrant.color,
      role: entrant.role, tier: entrant.tier, status: entrant.status, finished: entrant.boat.finished,
      finishSeconds: entrant.boat.finished ? entrant.boat.time : null,
      remainingMeters: Math.hypot(target.x - entrant.boat.position.x, target.y - entrant.boat.position.y),
      tacks: entrant.boat.tacks, distanceMeters: entrant.boat.distance };
  });
  rows.sort((a, b) => Number(b.finished) - Number(a.finished) ||
    (a.finished ? a.finishSeconds - b.finishSeconds : Number(a.status === 'timed-out') - Number(b.status === 'timed-out') || a.remainingMeters - b.remainingMeters) ||
    a.id.localeCompare(b.id));
  let place = 0, placeTime = null;
  return rows.map((row, index) => {
    if (row.finished && (placeTime === null || Math.abs(row.finishSeconds - placeTime) > 1e-7)) {
      place = index + 1; placeTime = row.finishSeconds;
    }
    return { ...row, order: index + 1, place: row.finished ? place : null, provisional: !row.finished };
  });
}
